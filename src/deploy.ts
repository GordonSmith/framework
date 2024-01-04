import readline from "node:readline/promises";
import {isatty} from "node:tty";
import type {BuildEffects} from "./build.js";
import {build} from "./build.js";
import type {Config} from "./config.js";
import {CliError} from "./error.js";
import type {Logger, Writer} from "./logger.js";
import {ObservableApiClient} from "./observableApiClient.js";
import {
  type ApiKey,
  type DeployConfig,
  getDeployConfig,
  getObservableApiKey,
  setDeployConfig
} from "./observableApiConfig.js";
import {blue} from "./tty.js";

export interface DeployOptions {
  config: Config;
}

export interface DeployEffects {
  getObservableApiKey: (logger: Logger) => Promise<ApiKey>;
  getDeployConfig: (sourceRoot: string) => Promise<DeployConfig | null>;
  setDeployConfig: (sourceRoot: string, config: DeployConfig) => Promise<void>;
  isTty: boolean;
  logger: Logger;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

const defaultEffects: DeployEffects = {
  getObservableApiKey,
  getDeployConfig,
  setDeployConfig,
  isTty: isatty(process.stdin.fd),
  logger: console,
  input: process.stdin,
  output: process.stdout
};

/** Deploy a project to ObservableHQ */
export async function deploy({config}: DeployOptions, effects = defaultEffects): Promise<void> {
  const {logger} = effects;
  const apiKey = await effects.getObservableApiKey(logger);
  const apiClient = new ObservableApiClient({apiKey});

  // Check configuration
  if (!config.deploy) {
    throw new CliError(
      "You haven't configured a project to deploy to. Please set deploy.workspace and deploy.project in your configuration."
    );
  }

  // Check last deployed state. If it's not the same project, ask the user if
  // they want to continue anyways. In non-interactive mode just cancel.
  const projectInfo = await apiClient.getProject({
    workspaceLogin: config.deploy.workspace,
    projectSlug: config.deploy.project
  });
  const deployConfig = await effects.getDeployConfig(config.root);
  const previousProjectId = deployConfig?.projectId;
  if (previousProjectId && previousProjectId !== projectInfo.id) {
    logger.log(
      `The project @${config.deploy.workspace}/${config.deploy.project} does not match the expected project in ${config.root}/.observablehq/deploy.json`
    );
    if (effects.isTty) {
      const choice = await promptUserForInput(
        effects.input,
        effects.output,
        "Do you want to update the expected project and deploy anyways? [y/N]"
      );
      if (choice.trim().toLowerCase().charAt(0) !== "y") {
        throw new CliError("User cancelled deploy.", {print: false, exitCode: 2});
      }
    } else {
      throw new CliError("Cancelling deploy due to misconfiguration.");
    }
  }
  await effects.setDeployConfig(config.root, {projectId: projectInfo.id});

  // Create the new deploy on the server
  const message = await promptUserForInput(effects.input, effects.output, "Deploy message: ");
  const deployId = await apiClient.postDeploy({projectId: projectInfo.id, message});

  // Build the project
  await build({config, clientEntry: "./src/client/deploy.js"}, new DeployBuildEffects(apiClient, deployId, effects));

  // Mark the deploy as uploaded
  const deployInfo = await apiClient.postDeployUploaded(deployId);
  logger.log(`Deployed project now visible at ${blue(deployInfo.url)}`);
}

async function promptUserForInput(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  question: string,
  defaultValue?: string
): Promise<string> {
  const rl = readline.createInterface({input, output});
  try {
    let value: string | null = null;
    do {
      value = await rl.question(question);
      if (!value && defaultValue) value = defaultValue;
    } while (!value);
    return value;
  } finally {
    rl.close();
  }
}

class DeployBuildEffects implements BuildEffects {
  readonly logger: Logger;
  readonly output: Writer;
  constructor(
    private readonly apiClient: ObservableApiClient,
    private readonly deployId: string,
    effects: DeployEffects
  ) {
    this.logger = effects.logger;
    this.output = effects.output;
  }
  async copyFile(sourcePath: string, outputPath: string) {
    this.logger.log(outputPath);
    await this.apiClient.postDeployFile(this.deployId, sourcePath, outputPath);
  }
  async writeFile(outputPath: string, content: Buffer | string) {
    this.logger.log(outputPath);
    await this.apiClient.postDeployFileContents(this.deployId, content, outputPath);
  }
}

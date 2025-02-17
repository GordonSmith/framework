# JavaScript: Promises

When code refers to a promise defined in another code block, the referencing code implicitly awaits the promise.

Most often, promises are used to load files, fetch data from a remote server, or query a database. TK Elaborate some more and give more specific examples of promises, including `FileAttachment`, `fetch`, `db.sql`, waiting to click on a button.

As a contrived example, within the block below, `hello` is a promise that resolves via `setTimeout`; if you reference `hello` from another code block or expression, the other code won’t run until the timeout fires and will see `hello` as a string.

```js echo
const hello = new Promise((resolve) => {
  setTimeout(() => {
    resolve("hello");
  }, 1000);
});
```

Hello is: ${hello}.

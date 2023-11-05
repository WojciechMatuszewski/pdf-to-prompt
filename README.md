## Learnings

- The middy library does not work super well with TypeScript. The basic support is there, but the types are not correctly augmented, especially when performing input/output validation.

    - I could not find any generic middleware engine for TypeScript.

        - Maybe it is not there as it is very hard to write one in a generic manner?

- I had to use `@middy/utils` package to have the AWS Lambda function output correct headers when I threw an error in the middleware chain.

    - Using packages like `http-errors` or similar did not work. The `content-type` was always `text/plain`

- The order of middlewares matters, a lot.

    - I had an issue where the request/response validator tried to validate a string instead of an object.

    - This was because the response parser did not run yet.

- Just like when hitting any other API, **you must configure CORS for S3 bucket you want to upload stuff to**.

    - Of course, this only needs to be done if CORS is required. For example when uploading files from the browser.

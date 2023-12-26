# PDF to Prompt

Implementing [this architecture](https://aws.amazon.com/blogs/compute/building-a-serverless-document-chat-with-aws-lambda-and-amazon-bedrock/) and learning about AI in the process.

I did not finish the frontend as I got what I wanted from this exercise.

## Running the backend

1. Download the `faiss-node` release packaged for [AWS from here](https://github.com/ewfian/faiss-node/releases).

   - Look for the x86 architecture.

2. Put the `nodejs` folder from the package into `layers/faiss-node`

3. Bootstrap the backend.

4. Deploy the backend.

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

- **LLM** is an instance of _foundational model_ which applies to text and text-related things.

  - They are **super flexible**. While this makes them relevant in almost every field or problem, **it also makes them less accurate given specific problem domain**.

  - One way to improve the output of the LLM is to **fine-tune your prompts**. A good heuristic is to **first give the LLM description of the task, and then a couple of examples which you know are valid**.

    - Supplying the examples manually is called **"hard prompting"**. There is also a way for the AI to generate this prompt. If that is the case, then it is called **"soft prompting"**.

    - Since adding additional benefit to the user prompt is quite large, you probably do not want to pass the user input "as is" into the LLM. You most likely want to use **a prompt template** augmented with the user input.

- **R**etrieval **A**ugmented **G**eneration means **adding additional set of data into the LLM "knowledge base"**. [Here is a great video about this topic](https://www.youtube.com/watch?v=T-D1OfcDW1M).

  - A good example would be asking the LLM about the planet with the highest amount of moons. **The data LLM has might be outdated** as such it might give you wrong answer. Now, if you **augment** the data LLM has with sources from, let us say NASA, the LLM would be able to give a correct answer.

    - **The LLM would first ask the "content store" for the answer**. If the answer is there, the LLM would use that as a data source. Otherwise it uses the knowledge it already has.

- In the context of AI, the **word embeddings** are representation of words as array of numbers called **vectors**.

  - You might think of embeddings as "classifications". The modal will classify some word to a given number.

  - The numbers in the vector represent how similar each word is to another word. For example, the vector for _"I took my cat for a walk_" would be similar in terms of numbers to the _"I took my dog for a walk"_.

  - The **embeddings are then feed into some kind of _similarity search_ engine** which LLM use to retrieve the final answer.

- The Amazon Bedrock exposes various models. One of them has an _"embedding" modality_ while others have _"text" modality_. What is the difference?

  - The **_"text" modality_** means

  - The **_"embedding" modality_** means

- The **name _LangChain_ comes from the fact that, to work with LLMs, one creates "chains" of inputs**.

  - The simplest would be the following: _input variables_ -> _prompt template_ -> _prompt_ -> _model_

    - In this example, we are "hard prompting" because it is up to us to craft the _prompt template_.

- Since we are bound by the input token limit, some libraries (like LangChain) opt to recursively provide prompts by splitting the context into multiple documents.

  - So far, the way I've seen RAG implemented was by providing the relevant context into the LLM prompt. What if the relevant context is very large? Would not asking the AI for the answer cost a lot of money (since we are billed by input/output tokens)?

    - It seems like the answer is to **split the context into small chunks, rank them and retrieve only the top "k" results**. This way we keep the context relatively small. While this might help, it still seems off to me. [This blog post](https://bea.stollnitz.com/blog/rag/) describes the filtering & ranking processes as well as the general idea behind RAG.

- The Bedrock model for embeddings does not seem to support streaming. When trying to use the `InvokeModelWithResponseStreamCommand` I got the following response

  > ValidationException: The model is unsupported for streaming

  I guess the closest we can get to streaming [is the _batch inference_ job](https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference.html).

- **You can add metadata to the S3 presigned URL via the `Fields` property**.

  - This is super handy for adding more information regarding the file. The consumer can then use `headObject` to retrieve it.

- Extracting text from PDF in ESM land is quite hard.

  - There are various libraries, but they are incompatible with ESM. The main problem are dynamic `require` calls.

  - There is the `pdf-dist` package, which mostly works.

    1. It requires you have `node-gyp` working which in most cases does not work and you have to install or reinstall some packages.

    2. I had to use "side-effect" import for the worker.

  - Of course, one could use the AWS Textract.

    1. The sync command does not work well for larger files. If the file is bigger than X, it rejects with an error saying that the "format of the file is incompatible" which is not the case.

- **If you see the `dynamic require of XX is not supported` error**, try creating the `require` variable before your code runs.

  - This error has to do with something about ESM.

  - In `esbuild` you can add this banner

    ```text
    banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
    ```

- In some cases, **when AWS Lambda runtime fails to parse the error**, you will get the following message.

  ```json
  {
    "errorType": "handled",
    "errorMessage": "callback called with Error argument, but there was a problem while retrieving one or more of its message, name, and stack"
  }
  ```

  I hit this error while creating a _vector store_ via the `faiss-node` library.

  ```ts
  const vectorStore = await FaissStore.fromDocuments(
    await loader.load(),
    embeddings
  );
  ```

  For some reason, AWS Lambda runtime **could not parse the error and print it**. **Using `console.log(error)` caused this weird runtime message to appear instead of the original error!**

  ```ts
  try {
    const vectorStore = await FaissStore.fromDocuments(
      await loader.load(),
      embeddings
    );
  } catch (error) {
    if (error instanceof Error) {
      console.log(error.name);
      console.log(error.message);

      console.log(error.stack); // <-- This line cases the weird runtime error
    }
  }
  ```

  **Printing the `stack` caused the weird runtime error to show up**. I wonder if this is some kind of security mechanism?

- I just spent a couple of hours debugging issue with `faiss-node` AWS Lambda Layer only to discover I used the layer for wrong architecture...

- When getting an object from S3, the SDK returns `StreamingBlobPayloadOutputTypes`. This in turns exposes methods allowing you to create either a buffer, string or a _web stream_ from the body.

  - I found it very hard to pipe the _web stream_ into `fs.createWriteStream`. It seems like the types are not compatible.

  - Also, examples in the internet are using the `reader` of the _web stream_. This means they are reading chunks separately rather than piping it to writable.

- I got hit again by the "limitations" of AWS Lambda Destinations.

  - Sadly, the `onSuccess` will not be invoked whenever the AWS Lambda is invoked by DynamoDB streams.

    - It does make sense, given the fact that such AWS Lambda is invoked synchronously.

    - Having said that, it would be awesome for AWS Lambda Destinations to work for sync invokes as well.

- **If you need to conditionally apply TailwindCSS styles**, consider the following approaches.

  1. Use some kind of library to apply them conditionally. One such example is the [`cslx` package](https://github.com/lukeed/clsx)

  2. **Use the `data-` attributes** and style based on them.

  ```jsx
  <li data-loading={isPending} className={"[loading='true']:opacity-50"}></li>
  ```

- I was trying to add the upload indicator for the document. The `reader` would always yield `{done: true, value: undefined}` and I could not figure out why is that the case.

  - **S3 was not returning anything, as such there was nothing to "download" back from the server**.

    - Looking back, it makes sense.

  - According to my research, it is not possible to track the "upload" progress indicator if your body is not `ReadableStream`.

    - I could not find any way to read the upload progress out of the `formData`.

  - **Axios has the "upload progress" feature, but it uses XHR requests rather than `fetch` API**. The XHR request have `addEventListener` API where you can listen to upload requests.

    - [Here is the implementation in Axios](https://github.com/axios/axios/blob/8befb86efb101ef9dc1d1c16d77d2bf42600727f/lib/adapters/xhr.js#L228)

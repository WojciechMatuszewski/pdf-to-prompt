# PDF to Prompt

Implementing [this architecture](https://aws.amazon.com/blogs/compute/building-a-serverless-document-chat-with-aws-lambda-and-amazon-bedrock/) and learning about AI in the process.

WIP

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

- **R**etrieval **A**ugmented **G**eneration means **adding additional set of data into the LLM "knowledge base"**. [Here is a great video about this topic](https://www.youtube.com/watch?v=T-D1OfcDW1M).

  - A good example would be asking the LLM about the planet with the highest amount of moons. **The data LLM has might be outdated** as such it might give you wrong answer. Now, if you **augment** the data LLM has with sources from, let us say NASA, the LLM would be able to give a correct answer.

    - **The LLM would first ask the "content store" for the answer**. If the answer is there, the LLM would use that as a data source. Otherwise it uses the knowledge it already has.

- In the context of AI, the **word embeddings** are representation of words as array of numbers called **vectors**.

  - The numbers in the vector represent how similar each word is to another word. For example, the vector for _"I took my cat for a walk_" would be similar in terms of numbers to the _"I took my dog for a walk"_.

  - The **embeddings are then feed into some kind of _similarity search_ engine** which LLM use to retrieve the final answer.

- TODO

  - https://js.langchain.com/docs/integrations/vectorstores/faiss

  - Local version to play around with the concept

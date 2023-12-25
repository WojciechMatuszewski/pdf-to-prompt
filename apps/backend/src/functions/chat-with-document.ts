import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import httpErrorHandler from "@middy/http-error-handler";
import httpHeaderNormalizer from "@middy/http-header-normalizer";
import httpResponseSerializer from "@middy/http-response-serializer";
import inputOutputLogger from "@middy/input-output-logger";
import { createError } from "@middy/util";
import { APIGatewayProxyEvent } from "aws-lambda";
import { RetrievalQAChain } from "langchain/chains";
import { BedrockEmbeddings } from "langchain/embeddings/bedrock";
import { Bedrock } from "langchain/llms/bedrock";
import { PromptTemplate } from "langchain/prompts";
import { FaissStore } from "langchain/vectorstores/faiss";
import fs from "fs-extra";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { object, safeParseAsync, string } from "valibot";

const embeddings = new BedrockEmbeddings({
  region: "eu-central-1",
  maxRetries: 0,
});

const model = new Bedrock({
  region: "eu-central-1",
  model: "anthropic.claude-v2",
  maxRetries: 0,
});

const RequestSchema = object({ prompt: string() });
const PathParametersSchema = object({ id: string() });

const s3Client = new S3Client({});

export const handler = middy<APIGatewayProxyEvent>()
  .use(httpHeaderNormalizer())
  .use(inputOutputLogger())
  .use(
    httpResponseSerializer({
      defaultContentType: "application/json",
      serializers: [
        {
          regex: /^application\/xml$/,
          serializer: ({ body }: { body: string }) =>
            `<message>${body}</message>`,
        },
        {
          regex: /^application\/json$/,
          serializer: ({ body }: { body: string }) => JSON.stringify(body),
        },
        {
          regex: /^text\/plain$/,
          serializer: ({ body }: { body: string }) => body,
        },
      ],
    })
  )
  .use(httpErrorHandler())
  .use(
    httpCors({
      methods: "OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD",
      headers:
        "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent",
      origin: "*",
    })
  )
  .handler(async (request) => {
    const parseBodyResult = await safeParseAsync(
      RequestSchema,
      JSON.parse(request.body ?? `{}`)
    );
    if (!parseBodyResult.success) {
      throw createError(400, "Malformed Payload", {
        expose: true,
        cause: parseBodyResult.issues,
      });
    }

    const parsePathParametersResult = await safeParseAsync(
      PathParametersSchema,
      request.pathParameters
    );
    if (!parsePathParametersResult.success) {
      throw createError(400, "Malformed path parameters", {
        expose: true,
        cause: parsePathParametersResult.issues,
      });
    }

    const { prompt } = parseBodyResult.output;
    const { id } = parsePathParametersResult.output;

    const vectorStoreObjectKeys = [
      `${id}/vector/docstore.json`,
      `${id}/vector/faiss.index`,
    ];

    const outputDirPath = `/tmp/${id}`;
    await fs.ensureDir(outputDirPath);

    for (const vectorStoreObjectKey of vectorStoreObjectKeys) {
      const { Body: readStream } = await s3Client.send(
        new GetObjectCommand({
          Bucket: process.env.PDF_BUCKET_NAME,
          Key: vectorStoreObjectKey,
        })
      );

      if (!(readStream instanceof Readable)) {
        throw createError(500, "The response is not a readable", {
          expose: true,
          cause: vectorStoreObjectKey,
        });
      }

      const writeStream = fs.createWriteStream(
        path.join(outputDirPath, path.basename(vectorStoreObjectKey))
      );

      await pipeline(readStream, writeStream);
    }

    const vectorStore = await FaissStore.load(outputDirPath, embeddings);

    const template = `Assistant:You are given text. Answer the question solely based on the text provided. Be very brief. If you do not know something, feel free to reply with "I do not know".\n\n\\{context}\n\nHuman:{question}\n\nAssistant:`;

    const chain = RetrievalQAChain.fromLLM(model, vectorStore.asRetriever(), {
      prompt: PromptTemplate.fromTemplate(template),
    });

    const { text } = await chain.call({
      query: prompt,
    });

    return {
      statusCode: 200,
      body: {
        response: text as string,
      },
    };
  });

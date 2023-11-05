import middy, { MiddlewareObj } from "@middy/core";
import httpCors from "@middy/http-cors";
import httpErrorHandler from "@middy/http-error-handler";
import httpHeaderNormalizer from "@middy/http-header-normalizer";
import jsonBodyParser from "@middy/http-json-body-parser";
import httpResponseSerializer from "@middy/http-response-serializer";
import inputOutputLogger from "@middy/input-output-logger";
import { createError } from "@middy/util";
import {
  Input,
  ObjectEntries,
  ObjectSchema,
  number,
  object,
  record,
  safeParseAsync,
  string,
} from "valibot";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { S3Client } from "@aws-sdk/client-s3";
import { ulid } from "ulidx";
import { APIGatewayEvent } from "aws-lambda";

const RequestSchema = object({ name: string(), size: number() });

const ResponseSchema = object({
  url: string(),
  fields: record(string()),
});

export const jsonBodyValidator = <
  RequestBodyFields extends ObjectEntries,
  ResponseBodyFields extends ObjectEntries,
>({
  requestBodySchema,
  responseBodySchema,
}: {
  requestBodySchema: ObjectSchema<RequestBodyFields>;
  responseBodySchema: ObjectSchema<ResponseBodyFields>;
}): MiddlewareObj<
  { body: Input<ObjectSchema<RequestBodyFields>> },
  { body: unknown }
> => {
  return {
    before: async (request) => {
      const parseResult = await safeParseAsync(
        requestBodySchema,
        request.event.body
      );

      if (!parseResult.success) {
        throw createError(403, JSON.stringify({ message: "Invalid payload" }), {
          cause: parseResult.issues,
        });
      }
    },
    after: async (output) => {
      const parseResult = await safeParseAsync(
        responseBodySchema,
        output.response?.body
      );

      if (!parseResult.success) {
        throw createError(
          500,
          JSON.stringify({ message: "Malformed response" }),
          { expose: true, cause: parseResult.issues }
        );
      }
    },
  };
};

const s3Client = new S3Client({});

export const handler = middy<APIGatewayEvent>()
  .use(httpHeaderNormalizer())
  .use(inputOutputLogger())
  .use(jsonBodyParser())
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
  .use(
    jsonBodyValidator({
      requestBodySchema: RequestSchema,
      responseBodySchema: ResponseSchema,
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
    const body: Input<typeof RequestSchema> = request.body;

    const id = ulid();
    const key = `${id}/${body.name}`;
    const bucketName = process.env.PDF_BUCKET_NAME!;

    const { url, fields } = await createPresignedPost(s3Client, {
      Bucket: bucketName,
      Key: key,
      Conditions: [
        { bucket: bucketName },
        ["starts-with", "$key", id],
        ["content-length-range", body.size, body.size],
      ],
      Expires: 600,
    });

    const response: Input<typeof ResponseSchema> = {
      fields,
      url,
    };

    return {
      statusCode: 200,
      body: response,
    };
  });

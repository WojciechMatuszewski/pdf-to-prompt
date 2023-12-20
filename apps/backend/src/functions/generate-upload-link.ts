import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import httpErrorHandler from "@middy/http-error-handler";
import httpHeaderNormalizer from "@middy/http-header-normalizer";
import httpResponseSerializer from "@middy/http-response-serializer";
import inputOutputLogger from "@middy/input-output-logger";
import { createError } from "@middy/util";
import { APIGatewayProxyEvent } from "aws-lambda";
import { ulid } from "ulidx";
import { Input, number, object, record, safeParseAsync, string } from "valibot";

const RequestSchema = object({ name: string(), size: number() });

const ResponseSchema = object({
  url: string(),
  fields: record(string()),
});

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

    const { size, name } = parseBodyResult.output;

    const id = ulid();
    const key = `${id}/data/file.pdf`;
    const bucketName = process.env.PDF_BUCKET_NAME!;

    const { url, fields } = await createPresignedPost(s3Client, {
      Bucket: bucketName,
      Key: key,
      Conditions: [
        { bucket: bucketName },
        ["starts-with", "$key", id],
        ["content-length-range", size, size],
      ],
      Expires: 600,
      Fields: {
        "x-amz-meta-name": name,
        "x-amz-meta-size_bytes": `${size}`,
        "x-amz-meta-id": id,
      },
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

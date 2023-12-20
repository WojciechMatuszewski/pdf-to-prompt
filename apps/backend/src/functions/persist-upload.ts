import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import middy from "@middy/core";
import httpErrorHandler from "@middy/http-error-handler";
import inputOutputLogger from "@middy/input-output-logger";
import { createError } from "@middy/util";
import { EventBridgeEvent } from "aws-lambda";
import {
  coerce,
  flatten,
  number,
  object,
  safeParseAsync,
  string,
} from "valibot";

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

const EventDetailSchema = object({
  bucket: object({ name: string() }),
  object: object({
    key: string(),
  }),
});

const MetadataSchema = object({
  size_bytes: coerce(number(), Number),
  name: string(),
  id: string(),
});

export const handler = middy<EventBridgeEvent<"_", unknown>>()
  .use(inputOutputLogger())
  .use(httpErrorHandler())
  .handler(async (event) => {
    const parseEventResult = await safeParseAsync(
      EventDetailSchema,
      event.detail
    );
    if (!parseEventResult.success) {
      throw createError(400, "Malformed event", {
        cause: flatten(parseEventResult.issues),
        expose: true,
      });
    }
    const {
      output: {
        object: { key: objectKey },
        bucket,
      },
    } = parseEventResult;

    const headResponse = await s3Client.send(
      new HeadObjectCommand({
        Key: objectKey,
        Bucket: bucket.name,
      })
    );

    const parseMetadataResult = await safeParseAsync(
      MetadataSchema,
      headResponse.Metadata
    );
    if (!parseMetadataResult.success) {
      throw createError(500, "Malformed metadata", {
        expose: true,
        cause: flatten(parseMetadataResult.issues),
      });
    }

    const { id, name } = parseMetadataResult.output;
    await ddbClient.send(
      new PutCommand({
        TableName: process.env.PDF_DATA_TABLE_NAME!,
        Item: {
          pk: "FILE",
          sk: `FILE#${id}`,
          id: id,
          name,
          status: "PENDING_EMBEDDINGS",
        },
      })
    );
  });

import middy from "@middy/core";
import httpErrorHandler from "@middy/http-error-handler";
import inputOutputLogger from "@middy/input-output-logger";
import { createError } from "@middy/util";
import { EventBridgeEvent } from "aws-lambda";
import { object, safeParseAsync, string } from "valibot";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const EventDetailSchema = object({
  bucket: object({ name: string() }),
  object: object({
    key: string(),
  }),
});

export const handler = middy<EventBridgeEvent<"_", unknown>>()
  .use(inputOutputLogger())
  .use(httpErrorHandler())
  .handler(async (event) => {
    const parseResult = await safeParseAsync(EventDetailSchema, event.detail);
    if (!parseResult.success) {
      throw createError(500, "Malformed event", {
        cause: parseResult.issues,
        expose: true,
      });
    }
    const {
      output: {
        object: { key: objectKey },
      },
    } = parseResult;

    const id = objectKey.slice(0, objectKey.indexOf("/"));
    const name = objectKey.slice(objectKey.lastIndexOf("/") + 1);

    await ddbClient.send(
      new PutCommand({
        TableName: process.env.PDF_DATA_TABLE_NAME!,
        Item: {
          pk: "FILE",
          sk: `FILE#${id}`,
          key: objectKey,
          name,
          status: "PENDING",
        },
      })
    );
  });

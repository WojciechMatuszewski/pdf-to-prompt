import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import middy from "@middy/core";
import httpErrorHandler from "@middy/http-error-handler";
import inputOutputLogger from "@middy/input-output-logger";
import { createError } from "@middy/util";
import { EventBridgeEvent } from "aws-lambda";
import { flatten, object, safeParseAsync, string } from "valibot";

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const EventDetailSchema = object({
  object: object({
    key: string(),
  }),
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
      },
    } = parseEventResult;

    const [id] = objectKey.split("/");
    if (!id) {
      throw createError(500, "MalformedKey", {
        expose: true,
        cause: { objectKey, id },
      });
    }

    await ddbClient.send(
      new UpdateCommand({
        TableName: process.env.PDF_DATA_TABLE_NAME!,
        UpdateExpression: "SET #status = :status",
        Key: {
          pk: "FILE",
          sk: `FILE#${id}`,
        },
        ExpressionAttributeValues: {
          ":status": "READY",
        },
        ExpressionAttributeNames: {
          "#status": "status",
        },
      })
    );
  });

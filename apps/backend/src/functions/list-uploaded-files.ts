import middy from "@middy/core";
import httpErrorHandler from "@middy/http-error-handler";
import inputOutputLogger from "@middy/input-output-logger";
import { APIGatewayProxyEvent } from "aws-lambda";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import httpCors from "@middy/http-cors";
import httpResponseSerializer from "@middy/http-response-serializer";
import { createError } from "@middy/util";
import {
  array,
  literal,
  object,
  safeParseAsync,
  startsWith,
  string,
} from "valibot";

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const ItemSchema = object({
  pk: literal("FILE"),
  sk: string([startsWith("FILE#")]),
  key: string(),
  name: string(),
  status: string(),
});

const ItemsSchema = array(ItemSchema);

export const handler = middy<APIGatewayProxyEvent>()
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
  .use(
    httpCors({
      methods: "OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD",
      headers:
        "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent",
      origin: "*",
    })
  )
  .use(httpErrorHandler())
  .handler(async () => {
    const { Items = [] } = await ddbClient.send(
      new QueryCommand({
        TableName: process.env.PDF_DATA_TABLE_NAME!,
        KeyConditionExpression:
          "#pk = :pk AND begins_with(#sk, :sk_starts_with)",
        ExpressionAttributeValues: {
          ":pk": "FILE",
          ":sk_starts_with": "FILE#",
        },
        ExpressionAttributeNames: {
          "#pk": "pk",
          "#sk": "sk",
        },
      })
    );
    const parseItemsResult = await safeParseAsync(ItemsSchema, Items);
    if (!parseItemsResult.success) {
      throw createError(500, "Malformed data", {
        expose: true,
        cause: parseItemsResult.issues,
      });
    }

    const normalizedItems = parseItemsResult.output.map((rawItem) => {
      const id = rawItem.sk.replace("FILE#", "");
      return {
        name: rawItem.name,
        status: rawItem.status,
        id,
      };
    });

    return {
      statusCode: 200,
      body: {
        items: normalizedItems,
      },
    };
  });

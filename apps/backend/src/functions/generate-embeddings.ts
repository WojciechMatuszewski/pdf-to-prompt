import { DynamoDBStreamEvent } from "aws-lambda";

import { AttributeValue } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { object, parse, string } from "valibot";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import { BedrockEmbeddings } from "langchain/embeddings/bedrock";
import { FaissStore } from "langchain/vectorstores/faiss";
import fs from "node:fs/promises";
import "pdf-parse";

const s3Client = new S3Client({});

const ItemSchema = object({
  id: string(),
});

export const handler = async (event: DynamoDBStreamEvent) => {
  for (const record of event.Records) {
    const imageRecord = (record.dynamodb?.NewImage ?? {}) as Record<
      string,
      AttributeValue
    >;

    const rawItem = unmarshall(imageRecord);
    const { id } = parse(ItemSchema, rawItem);
    const fileKey = `${id}/data/file.pdf`;

    const { Body: rawFileContents } = await s3Client.send(
      new GetObjectCommand({
        Key: fileKey,
        Bucket: process.env.PDF_BUCKET_NAME,
      })
    );
    if (!rawFileContents) {
      throw new Error("boom");
    }

    /**
     * {
    "errorType": "Error",
    "errorMessage": "Dynamic require of \"fs\" is not supported",
    "stack": [
        "Error: Dynamic require of \"fs\" is not supported",
        "    at file:///var/task/index.mjs:13:9",
        "    at node_modules/.pnpm/pdf-parse@1.1.1/node_modules/pdf-parse/index.js (file:///var/task/index.mjs:244901:14)",
        "    at __require2 (file:///var/task/index.mjs:25:52)",
        "    at file:///var/task/index.mjs:270483:32",
        "    at ModuleJob.run (node:internal/modules/esm/module_job:194:25)"
    ]
}
     */

    const fileBlob = new Blob([await rawFileContents.transformToByteArray()]);
    const loader = new PDFLoader(fileBlob);
    const docs = await loader.load();

    const vectorStore = await FaissStore.fromDocuments(
      docs,
      new BedrockEmbeddings({
        region: "eu-west-1",
      })
    );

    const dir = await fs.mkdtemp("/tmp");

    await vectorStore.save(dir);
  }
};

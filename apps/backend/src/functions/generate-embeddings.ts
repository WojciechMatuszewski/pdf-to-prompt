import { DynamoDBStreamEvent } from "aws-lambda";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { BedrockEmbeddings } from "langchain/embeddings/bedrock";

import { FaissStore } from "langchain/vectorstores/faiss";
import { AttributeValue } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { object, parse, string } from "valibot";

import fs from "node:fs/promises";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import "pdfjs-dist/build/pdf.worker.mjs";
import {
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist/types/src/display/api.js";
import { execSync } from "node:child_process";

const s3Client = new S3Client({});
const embeddings = new BedrockEmbeddings({ region: "eu-central-1" });

const ItemSchema = object({
  id: string(),
});

export const handler = async (event: DynamoDBStreamEvent) => {
  // const output = execSync(
  //   "ls -la /opt/nodejs/node_modules/faiss-node/build/Release/faiss-node.node"
  // );

  console.log(process.env.NODE_PATH);

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
      throw new Error("Failed to get the file contents from s3");
    }

    const document = await pdfjs.getDocument(
      await rawFileContents.transformToByteArray()
    ).promise;
    const documentText = await extractDocumentText(document);

    const loader = new TextLoader(
      new Blob([documentText], { type: "plain/text" })
    );

    try {
      const vectorStore = await FaissStore.fromDocuments(
        await loader.load(),
        embeddings
      );
    } catch (error) {
      if (error instanceof Error) {
        console.log(error.name);
        console.log(error.message);
        // console.log(error.stack);
      }
    }

    // const dir = await fs.mkdtemp("/tmp");
    // await vectorStore.save(dir);
  }
};

async function extractDocumentText(document: PDFDocumentProxy) {
  const pageNumbers = Array.from(
    {
      length: document.numPages,
    },
    /**
     * The `getPage` starts from 1
     */
    (_, pageNum) => pageNum + 1
  );

  const textForEachPage = await Promise.all(
    pageNumbers.map(async (pageNumber) => {
      return document.getPage(pageNumber).then((page) => {
        return extractPageText(page);
      });
    })
  );

  const documentText = textForEachPage.reduce((text, pageText) => {
    return text.concat(pageText);
  }, "");
  return documentText;
}

async function extractPageText(page: PDFPageProxy) {
  const pageTextContent = await page.getTextContent();

  const pageText = pageTextContent.items.reduce(
    (textContent, pageTextContentItem) => {
      const hasContent = "str" in pageTextContentItem;
      if (!hasContent) {
        return textContent;
      }

      /**
       * No need for newline. The less tokens the better
       */
      const newline = pageTextContentItem.hasEOL ? ` ` : ``;
      const content = pageTextContentItem.str;
      return textContent.concat(`${content}${newline}`);
    },
    ""
  );

  return pageText;
}

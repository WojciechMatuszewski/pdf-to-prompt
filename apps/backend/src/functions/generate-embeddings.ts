import { DynamoDBStreamEvent } from "aws-lambda";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { BedrockEmbeddings } from "langchain/embeddings/bedrock";

import { AttributeValue } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { FaissStore } from "langchain/vectorstores/faiss";
import { object, parse, string } from "valibot";
import path from "node:path";

import fsPromises from "node:fs/promises";
import fs from "node:fs";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import "pdfjs-dist/build/pdf.worker.mjs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist/types/src/display/api.js";
import { globby } from "globby";
import middy from "@middy/core";
import inputOutputLogger from "@middy/input-output-logger";
import httpErrorHandler from "@middy/http-error-handler";
import { createError } from "@middy/util";

const s3Client = new S3Client({});
const embeddings = new BedrockEmbeddings({ region: "eu-central-1" });

const ItemSchema = object({
  id: string(),
});

export const handler = middy<DynamoDBStreamEvent>()
  .use(inputOutputLogger())
  .use(httpErrorHandler())
  .handler(async (event) => {
    const documentIds = getDocumentIds(event);

    for (const documentId of documentIds) {
      const fileKey = `${documentId}/data/file.pdf`;

      const { Body: rawFileContents } = await s3Client.send(
        new GetObjectCommand({
          Key: fileKey,
          Bucket: process.env.PDF_BUCKET_NAME,
        })
      );
      if (!rawFileContents) {
        throw createError(500, "The file appears to be empty", {
          expose: true,
        });
      }

      const document = await pdfjs.getDocument(
        await rawFileContents.transformToByteArray()
      ).promise;
      const documentText = await extractDocumentText(document);

      const loader = new TextLoader(
        new Blob([documentText], { type: "plain/text" })
      );

      const vectorStore = await FaissStore.fromDocuments(
        await loader.load(),
        embeddings
      );

      const dir = await fsPromises.mkdtemp("/tmp/");
      await vectorStore.save(dir);
      const vectorStoreFiles = await globby(dir);

      await Promise.all(
        vectorStoreFiles.map((filePath) => {
          const basename = path.basename(filePath);

          return s3Client.send(
            new PutObjectCommand({
              Key: `${documentId}/vector/${basename}`,
              Body: fs.createReadStream(filePath),
              Bucket: process.env.PDF_BUCKET_NAME,
            })
          );
        })
      );
    }

    /**
     * For the `onSuccess` handler
     */
    return documentIds;
  });

function getDocumentIds(event: DynamoDBStreamEvent) {
  return event.Records.map((record) => {
    const imageRecord = (record.dynamodb?.NewImage ?? {}) as Record<
      string,
      AttributeValue
    >;

    const rawItem = unmarshall(imageRecord);
    const { id } = parse(ItemSchema, rawItem);
    return id;
  });
}

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

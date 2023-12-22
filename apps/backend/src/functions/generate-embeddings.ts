import { DynamoDBStreamEvent } from "aws-lambda";

import { AttributeValue } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { object, parse, string } from "valibot";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import "pdfjs-dist/build/pdf.worker.mjs";

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
      throw new Error("Failed to get the file contents from s3");
    }

    const document = await pdfjs.getDocument(
      await rawFileContents.transformToByteArray()
    ).promise;

    const firstPage = await document.getPage(1);

    console.log(await firstPage.getTextContent());

    // const fileBuf = Buffer.from(await rawFileContents.transformToByteArray());
    // const fileText = await extractPDFText(fileBuf);

    // const loader = new TextLoader(new Blob([fileText], { type: "plain/text" }));
    // const docs = await loader.load();

    // const vectorStore = await FaissStore.fromDocuments(
    //   docs,
    //   new BedrockEmbeddings({
    //     region: "eu-west-1",
    //   })
    // );

    // const dir = await fs.mkdtemp("/tmp");
    // await vectorStore.save(dir);
  }
};

// const extractor = new PDFExtract();
// async function extractPDFText(fileBuf: Buffer) {
//   const response = await extractor.extractBuffer(fileBuf);

//   const pdfText = response.pages.reduce((combinedText, currentPage) => {
//     const pageText = currentPage.content.reduce(
//       (combinedPageText, currentPageContentChunk) => {
//         return combinedPageText.concat(currentPageContentChunk.str);
//       },
//       ""
//     );

//     return combinedText.concat(pageText);
//   }, "");

//   return pdfText;
// }

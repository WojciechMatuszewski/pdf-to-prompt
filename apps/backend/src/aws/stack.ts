import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import path from "node:path";
import url from "node:url";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

export class PdfPromptStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const pdfDataTable = new cdk.aws_dynamodb.Table(this, "PdfData", {
      partitionKey: {
        name: "pk",
        type: cdk.aws_dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "sk",
        type: cdk.aws_dynamodb.AttributeType.STRING,
      },
      billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const pdfBucket = new cdk.aws_s3.Bucket(this, "PdfBucket", {
      cors: [
        {
          allowedMethods: [
            cdk.aws_s3.HttpMethods.GET,
            cdk.aws_s3.HttpMethods.POST,
            cdk.aws_s3.HttpMethods.HEAD,
            cdk.aws_s3.HttpMethods.DELETE,
          ],
          allowedOrigins: ["*"],
        },
      ],
      eventBridgeEnabled: true,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const persistUploadFunction = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      "PersistUpload",
      {
        handler: "handler",
        entry: path.join(__dirname, "../functions/persist-upload.ts"),
        bundling: {
          format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
          mainFields: ["module", "main"],
          esbuildArgs: {
            "--conditions": "module",
          },
        },
        environment: {
          PDF_DATA_TABLE_NAME: pdfDataTable.tableName,
        },
      }
    );
    pdfDataTable.grantWriteData(persistUploadFunction);
    new cdk.aws_events.Rule(this, "PdfBucketPdfUploaded", {
      eventPattern: {
        source: ["aws.s3"],
        detailType: ["Object Created"],
        detail: {
          bucket: {
            name: [pdfBucket.bucketName],
          },
          object: {
            key: [{ suffix: ".pdf" }],
          },
        },
      },
      targets: [
        new cdk.aws_events_targets.LambdaFunction(persistUploadFunction, {
          retryAttempts: 0,
        }),
      ],
    });

    const generateUploadLinkFunction = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      "GenerateUploadLink",
      {
        handler: "handler",
        entry: path.join(__dirname, "../functions/generate-upload-link.ts"),
        bundling: {
          format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
          mainFields: ["module", "main"],
          esbuildArgs: {
            "--conditions": "module",
          },
        },
        environment: {
          PDF_BUCKET_NAME: pdfBucket.bucketName,
        },
      }
    );
    pdfBucket.grantReadWrite(generateUploadLinkFunction);

    const listUploadsFunction = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      "ListUploadedFile",
      {
        handler: "handler",
        entry: path.join(__dirname, "../functions/list-uploaded-files.ts"),
        bundling: {
          format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
          mainFields: ["module", "main"],
          esbuildArgs: {
            "--conditions": "module",
          },
        },
        environment: {
          PDF_DATA_TABLE_NAME: pdfDataTable.tableName,
        },
      }
    );
    pdfDataTable.grantReadData(listUploadsFunction);

    const api = new cdk.aws_apigateway.RestApi(this, "PdfPromptApi", {
      defaultCorsPreflightOptions: {
        allowOrigins: cdk.aws_apigateway.Cors.ALL_ORIGINS,
      },
    });

    api.root
      .addResource("generate-upload-link")
      .addMethod(
        "POST",
        new cdk.aws_apigateway.LambdaIntegration(generateUploadLinkFunction)
      );

    api.root
      .addResource("list-uploaded-files")
      .addMethod(
        "GET",
        new cdk.aws_apigateway.LambdaIntegration(listUploadsFunction)
      );
  }
}

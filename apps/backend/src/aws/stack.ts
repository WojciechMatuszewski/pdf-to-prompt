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
      stream: cdk.aws_dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
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
    pdfBucket.grantRead(persistUploadFunction);
    new cdk.aws_events.Rule(this, "PdfBucketPdfUploaded", {
      eventPattern: {
        source: ["aws.s3"],
        detailType: ["Object Created"],
        detail: {
          bucket: {
            name: [pdfBucket.bucketName],
          },
          object: {
            key: [{ wildcard: "*/data/*.pdf" }],
          },
        },
      },
      targets: [
        new cdk.aws_events_targets.LambdaFunction(persistUploadFunction, {
          retryAttempts: 0,
        }),
      ],
    });

    const faissNodeLayer = new cdk.aws_lambda.LayerVersion(
      this,
      "FaissNodeLayer",
      {
        code: cdk.aws_lambda.Code.fromAsset(
          path.join(__dirname, "../layers/faiss-node")
        ),
        compatibleArchitectures: [cdk.aws_lambda.Architecture.X86_64],
        compatibleRuntimes: [cdk.aws_lambda.Runtime.NODEJS_LATEST],
      }
    );
    /**
     * TODO: not possible to have onSuccess here since this function is invoked by DynamoDB
     */
    const generateEmbeddingsFunction = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      "GenerateEmbeddings",
      {
        handler: "handler",
        entry: path.join(__dirname, "../functions/generate-embeddings.ts"),
        layers: [faissNodeLayer],
        bundling: {
          format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
          mainFields: ["module", "main"],
          externalModules: ["faiss-node"],
          esbuildArgs: {
            "--conditions": "module",
          },
          loader: {
            /**
             * esbuild does not know what to do with `.node` files.
             */
            ".node": "file",
          },
          banner: `const require = (await import("node:module")).Module.createRequire(import.meta.url); const __filename = (await import("node:url")).fileURLToPath(import.meta.url);`,
        },
        memorySize: 1024,
        timeout: cdk.Duration.seconds(10),
        environment: {
          PDF_BUCKET_NAME: pdfBucket.bucketName,
        },
      }
    );
    pdfBucket.grantReadWrite(generateEmbeddingsFunction);
    generateEmbeddingsFunction.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: ["*"],
      })
    );

    generateEmbeddingsFunction.addEventSource(
      new cdk.aws_lambda_event_sources.DynamoEventSource(pdfDataTable, {
        startingPosition: cdk.aws_lambda.StartingPosition.LATEST,
        filters: [
          cdk.aws_lambda.FilterCriteria.filter({
            eventName: cdk.aws_lambda.FilterRule.isEqual("INSERT"),
            dynamodb: {
              NewImage: {
                status: {
                  S: cdk.aws_lambda.FilterRule.isEqual("PENDING_EMBEDDINGS"),
                },
              },
            },
          }),
        ],
        retryAttempts: 0,
        reportBatchItemFailures: false,
        bisectBatchOnError: false,
      })
    );

    const persistEmbeddingsFunction = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      "PersistEmbeddings",
      {
        handler: "handler",
        entry: path.join(__dirname, "../functions/persist-embeddings.ts"),
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
    pdfDataTable.grantWriteData(persistEmbeddingsFunction);

    new cdk.aws_events.Rule(this, "PdfBucketEmbeddingsUploaded", {
      eventPattern: {
        source: ["aws.s3"],
        detailType: ["Object Created"],
        detail: {
          bucket: {
            name: [pdfBucket.bucketName],
          },
          object: {
            key: [{ wildcard: "*/vector/faiss.index" }],
          },
        },
      },
      targets: [
        new cdk.aws_events_targets.LambdaFunction(persistEmbeddingsFunction, {
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

    const chatWithDocumentFunction = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      "ChatWithDocument",
      {
        handler: "handler",
        entry: path.join(__dirname, "../functions/chat-with-document.ts"),
        layers: [faissNodeLayer],
        bundling: {
          format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
          mainFields: ["module", "main"],
          esbuildArgs: {
            "--conditions": "module",
          },
          externalModules: ["faiss-node"],
          banner: `const require = (await import("node:module")).Module.createRequire(import.meta.url); const __filename = (await import("node:url")).fileURLToPath(import.meta.url);`,
        },
        environment: {
          PDF_DATA_TABLE_NAME: pdfDataTable.tableName,
          PDF_BUCKET_NAME: pdfBucket.bucketName,
        },
        memorySize: 1024,
        timeout: cdk.Duration.seconds(15),
      }
    );
    pdfDataTable.grantReadData(chatWithDocumentFunction);
    pdfBucket.grantRead(chatWithDocumentFunction);
    chatWithDocumentFunction.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: ["*"],
      })
    );

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

    api.root
      .addResource("{id}")
      .addResource("chat")
      .addMethod(
        "POST",
        new cdk.aws_apigateway.LambdaIntegration(chatWithDocumentFunction)
      );
  }
}

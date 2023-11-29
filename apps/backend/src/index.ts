import * as cdk from "aws-cdk-lib";
import { PdfPromptStack } from "./aws/stack.js";
import { IConstruct } from "constructs";

const app = new cdk.App();

const stack = new PdfPromptStack(app, "PdfPromptStack", {
  synthesizer: new cdk.DefaultStackSynthesizer({
    qualifier: "pdfprompt",
  }),
});

class AddRemovalPolicyToEveryResource implements cdk.IAspect {
  public visit(node: IConstruct): void {
    if (node instanceof cdk.CfnResource) {
      node.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    }
  }
}

cdk.Aspects.of(stack).add(new AddRemovalPolicyToEveryResource());

// lib/tagging-aspect.ts
import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

export class BasicTagger implements cdk.IAspect {
  private readonly key: string;
  private readonly value: string;
  constructor(key: string, value: string) { this.key = key; this.value = value; }
  public visit(node: IConstruct): void {
    if (cdk.TagManager.isTaggable(node)) { node.tags.setTag(this.key, this.value); }
  }
}

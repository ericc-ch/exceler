import { Schema } from "effect"

export const GitHubAsset = Schema.Struct({
  contentType: Schema.String,
  size: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  downloadCount: Schema.Number,
  downloadUrl: Schema.String,
})

export const GitHubRelease = Schema.Struct({
  id: Schema.Number,
  tag: Schema.String,
  author: Schema.String,
  name: Schema.String,
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
  createdAt: Schema.String,
  publishedAt: Schema.String,
  markdown: Schema.String,
  html: Schema.String,
  assets: Schema.Array(GitHubAsset),
})

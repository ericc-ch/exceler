import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import envPaths from "env-paths"
import os from "node:os"
import { GitHubRelease } from "./schema.ts"

const LatestReleaseResponse = Schema.Struct({
  release: GitHubRelease,
})

const getPlatform = (platform: NodeJS.Platform) => {
  switch (platform) {
    case "linux":
      return "ubuntu"
    default:
      return platform
  }
}

export class LlamaCpp extends Context.Service<LlamaCpp>()("LlamaCpp", {
  make: Effect.gen(function* () {
    const arch = os.arch()
    const platform = getPlatform(os.platform())
    const paths = envPaths("exceler")
    const fs = yield* FileSystem.FileSystem
    const client = yield* HttpClient.HttpClient

    return {
      install: Effect.gen(function* () {
        const installDir = paths.data

        yield* fs.makeDirectory(installDir, { recursive: true })

        const req = HttpClientRequest.get(
          "https://ungh.cc/repos/ggml-org/llama.cpp/releases/latest",
        )
        const res = yield* client.execute(req)
        const body = yield* HttpClientResponse.schemaBodyJson(LatestReleaseResponse)(res)

        const asset = body.release.assets.find(
          (asset) =>
            asset.downloadUrl.includes(platform) &&
            asset.downloadUrl.includes(arch) &&
            asset.downloadUrl.includes("vulkan"),
        )

        yield* Effect.log(asset)
      }),
    }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

import { Context, Data, Effect, FileSystem, Path, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { NodeHttpClient } from "@effect/platform-node"
import { $ } from "bun"
import envPaths from "env-paths"

const latestReleaseUrl = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest"

export class GitHubAsset extends Schema.Class<GitHubAsset>("GitHubAsset")({
  name: Schema.String,
  browser_download_url: Schema.String,
}) {}

class GitHubRelease extends Schema.Class<GitHubRelease>("GitHubRelease")({
  tag_name: Schema.String,
  assets: Schema.Array(GitHubAsset),
}) {}

export class LlamaCppInstall extends Schema.Class<LlamaCppInstall>("LlamaCppInstall")({
  tag: Schema.String,
  installDir: Schema.String,
  llamaCli: Schema.String,
  llamaServer: Schema.String,
}) {}

export class LlamaCppInstallError extends Data.TaggedError("LlamaCppInstallError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export const installLlamaCpp = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const installDir = getInstallDir()
  const binDir = path.join(installDir, "bin")
  const llamaCli = path.join(binDir, executableName("llama-cli"))
  const llamaServer = path.join(binDir, executableName("llama-server"))

  if ((yield* fs.exists(llamaCli)) && (yield* fs.exists(llamaServer))) {
    return new LlamaCppInstall({ tag: "installed", installDir, llamaCli, llamaServer })
  }

  yield* fs.makeDirectory(installDir, { recursive: true })

  const release = yield* fetchLatestRelease
  const asset = selectCpuAsset(release.assets, process.platform, process.arch)
  const archivePath = path.join(installDir, asset.name)
  const stagingDir = path.join(installDir, ".staging")

  yield* fs.remove(stagingDir, { force: true, recursive: true })
  yield* fs.makeDirectory(stagingDir, { recursive: true })
  yield* download(asset.browser_download_url, archivePath)
  yield* extractArchive(archivePath, stagingDir)

  yield* fs.remove(binDir, { force: true, recursive: true })
  yield* fs.makeDirectory(binDir, { recursive: true })
  yield* fs.copy(stagingDir, binDir, { overwrite: true })
  yield* fs.remove(stagingDir, { force: true, recursive: true })

  if (!(yield* fs.exists(llamaCli)) || !(yield* fs.exists(llamaServer))) {
    return yield* new LlamaCppInstallError({
      message: `llama.cpp archive did not contain expected binaries in ${binDir}`,
    })
  }

  return new LlamaCppInstall({ tag: release.tag_name, installDir, llamaCli, llamaServer })
}).pipe(Effect.provide(NodeHttpClient.layerUndici), Effect.mapError(toInstallError))

export class LlamaCpp extends Context.Service<LlamaCpp>()("LlamaCpp", {
  make: Effect.succeed({
    install: installLlamaCpp,
  }),
}) {}

export function getInstallDir(): string {
  return envPaths("exceler", { suffix: "" }).data
}

export function selectCpuAsset(
  assets: ReadonlyArray<GitHubAsset>,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): GitHubAsset {
  const platformPart = platformAssetPart(platform)
  const archPart = archAssetPart(arch)
  const archiveSuffix = platform === "win32" ? ".zip" : ".tar.gz"

  const asset = assets.find(
    (asset) =>
      asset.name.startsWith("llama-") &&
      asset.name.includes("-bin-") &&
      asset.name.includes(platformPart) &&
      asset.name.includes(archPart) &&
      asset.name.endsWith(archiveSuffix) &&
      !isAcceleratedAsset(asset.name),
  )

  if (asset === undefined) {
    throw new Error(`No llama.cpp CPU binary found for ${platform}/${arch}`)
  }

  return asset
}

const fetchLatestRelease = HttpClient.get(latestReleaseUrl, {
  headers: {
    Accept: "application/vnd.github+json",
    "User-Agent": "exceler",
  },
}).pipe(
  Effect.flatMap(HttpClientResponse.filterStatusOk),
  Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubRelease)),
  Effect.mapError(toInstallError),
)

function download(url: string, destination: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const response = yield* HttpClient.get(url, {
      headers: {
        "User-Agent": "exceler",
      },
    })
    const bytes = yield* response.pipe(
      HttpClientResponse.filterStatusOk,
      Effect.flatMap((response) => response.arrayBuffer),
      Effect.map((buffer) => new Uint8Array(buffer)),
    )

    yield* fs.writeFile(destination, bytes)
  }).pipe(Effect.mapError(toInstallError))
}

function extractArchive(archivePath: string, destination: string) {
  return Effect.tryPromise({
    try: async () => {
      if (archivePath.endsWith(".tar.gz")) {
        await $`tar -xzf ${archivePath} -C ${destination}`
        return
      }

      if (archivePath.endsWith(".zip")) {
        await $`unzip -q ${archivePath} -d ${destination}`
        return
      }

      throw new LlamaCppInstallError({
        message: `Unsupported llama.cpp archive format: ${archivePath}`,
      })
    },
    catch: toInstallError,
  })
}

function platformAssetPart(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "macos"
    case "linux":
      return "ubuntu"
    case "win32":
      return "win"
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
}

function archAssetPart(arch: NodeJS.Architecture): string {
  switch (arch) {
    case "arm64":
      return "arm64"
    case "x64":
      return "x64"
    default:
      throw new Error(`Unsupported architecture: ${arch}`)
  }
}

function executableName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name
}

function isAcceleratedAsset(name: string): boolean {
  return ["aclgraph", "cuda", "kompute", "kleidiai", "openvino", "rocm", "sycl", "vulkan"].some(
    (backend) => name.includes(backend),
  )
}

function toInstallError(cause: unknown): LlamaCppInstallError {
  return cause instanceof LlamaCppInstallError
    ? cause
    : new LlamaCppInstallError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      })
}

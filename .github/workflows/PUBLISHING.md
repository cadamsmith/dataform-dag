# Publishing the extension

The [`publish.yml`](./publish.yml) workflow packages the extension once and pushes
that same `.vsix` to both the **Visual Studio Marketplace** and **Open VSX**.

## How to cut a release

1. Bump the version in `apps/extension/package.json` and merge to `main`.
2. Create a GitHub Release with a matching tag (e.g. `v0.1.1`).
3. The workflow runs automatically and publishes to both registries. You can also
   trigger it by hand from **Actions → Publish Extension → Run workflow**.

## One-time setup (required before the first run)

The workflow fails on its first run until each of these is done once.

### 1. Add two repository secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Where to get it |
| --- | --- |
| `VSCE_PAT` | Azure DevOps Personal Access Token for the `cadamsmith` publisher, with **Marketplace → Manage** scope. See <https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token>. |
| `OVSX_PAT` | Access token from your open-vsx.org account (**Settings → Access Tokens**). See <https://github.com/eclipse/openvsx/wiki/Publishing-Extensions>. |

`vsce` and `ovsx` read these env var names automatically — no `-p` flag needed.

### 2. Prepare the Open VSX namespace (Open VSX only)

Open VSX requires a namespace and a signed publisher agreement before it will
accept an upload:

1. Sign in to <https://open-vsx.org> with GitHub.
2. Sign the **Eclipse Foundation Publisher Agreement** (Profile → Settings).
3. Create the `cadamsmith` namespace once, locally:

   ```sh
   npx ovsx create-namespace cadamsmith -p <YOUR_OVSX_PAT>
   ```

   This is intentionally **not** in the workflow — it only needs to happen once
   and would error on every subsequent run.

The Visual Studio Marketplace publisher (`cadamsmith`) must likewise already exist
at <https://marketplace.visualstudio.com/manage>.

## Publishing manually from your machine

```sh
cd apps/extension
npm run package -- -o extension.vsix
VSCE_PAT=<token> npm run publish:vsce
OVSX_PAT=<token> npm run publish:ovsx
```

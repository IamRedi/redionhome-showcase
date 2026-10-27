# Verification record

Prepared on 27 October 2026 and published after explicit owner review. This is a
separate evaluation repository. The original project and installation remain private.

## Source and scope

- Source branch: `codex/f3-real-integrations` at
  `83a9743e8fe4a709193b12b3720fe2dbb719f480`.
- Executable source baseline: `0ca4fd2faea672b2fb2e3c1a1110208b9bd392ba`.
- Only tracked source was exported. The new repository starts fresh; no private
  history, operational notes, owner media, SQLite database or credentials were copied.
- Original installation, devices, branch, main and repository visibility were not changed.
- The current interface is Albanian. German and English cover documentation and
  video captions. Complete hardware integrations and full UI localization are not claimed.

## Isolated demo

The safe launcher uses a marked synthetic database, a clean allowlisted environment,
loopback binding and an outbound network guard. Unknown existing databases are
refused. Integration configuration writes are blocked. Camera, microphone, speech
recognition and real assistant providers are disabled in the showcase build.

The assistant is explicitly labeled `scripted-showcase` / `no-model`. A virtual
light proposal still uses the application's permission and confirmation path.
There were zero real AI provider calls and zero physical device commands during capture.

Public CC0 panoramas are downloaded from Poly Haven with pinned SHA-256 values.
They are demonstration spaces, not a surveyed reconstruction of the owner's home.
The two build targets have distinct identities: normal `dist` for regression
tests; `showcase-dist` with the additional demo restrictions for presentation.

## Checks

| Check | Result |
|---|---|
| ESLint | Passed locally |
| Backend/unit/integration | 154 tests passed across 19 files |
| TypeScript and production build | Passed locally |
| Restricted showcase build | Passed locally |
| Desktop/mobile browser regression | All 62 distinct checks covered: full run 61 passed; 2 targeted passes after test timing correction |
| Historical client update/draft path | 1 passed: legacy → current → successor → rollback, two tabs and drafts preserved |
| Safe demo HTTP smoke | Passed: auth, synthetic home, scripted assistant, blocked integration write and AI route |
| Publication surface / media hashes | 243 tracked files checked; 0 issues |
| Gitleaks directory/history | 0 findings; nonempty scan of the fresh root commit |
| GitHub Actions | Runs on public `main`; check the live CI link below for the current commit |
| Container runtime | Not verified locally: Docker Desktop cannot start on this host |

[Current hosted CI](https://github.com/IamRedi/redionhome-showcase/actions/workflows/ci.yml).
The initial private-repository runs did not execute any steps because of an
account-level Actions restriction; those runs are not completed validation.
The owner subsequently approved publication of this reviewed showcase. No account
setting was changed. Hosted results are separate from the local checks above.

Local backend/build/browser execution uses Ubuntu on WSL2, Node 22.23.4 and
Chromium with software WebGL. Desktop and mobile are browser viewport projects,
not acceptance on physical phones. Media capture uses the Windows in-app browser.

Initial headless-shell attempts timed out on screenshots and panorama navigation.
The complete browser suite now uses Playwright's full Chromium channel with
120-second per-test budgets, no retries and unchanged behavioral assertions.
The two previously affected representative flows passed separately (2 tests).

The historical update test retains its real old-client/draft/upgrade flow via a
source-only fixture, rather than referencing private Git history. A sensor test
was corrected to inspect actual reading values: the old whole-response text
assertion could accidentally match a timestamp ending in `.200Z`.
Two additional tests verify the outbound guard and refusal of an unknown database.

The 62-test full run finished with 61 passes and one expired-toast assertion.
That assertion originally followed several unrelated device-control actions;
the toast intentionally expires after seven seconds. The test now checks save
feedback and menu hiding immediately after save, then reopens the device and
verifies the same control assertions. Both desktop and mobile variants passed
in the targeted rerun. No behavior assertion or screenshot was removed, and no
application timing was changed to satisfy the test.

## Media

Actual browser interactions covered object edit/save, a permission-gated scripted
proposal, confirmation of a mock light, ambient save and an explicit visitor
preview. Piano keys are a browser simulation; no MIDI or device connection occurs.
The showroom screenshot is a visitor preview, not a public deployment.

The silent 43-second DE/EN videos are captioned montages of actual screenshots,
not continuous interaction recordings. Both MP4 files are fully decoded during
generation. Original images, derivatives and captions are checksummed in the
[media manifest](docs/assets/media-manifest.json). The social card is a typographic
graphic, not a synthetic application screenshot. The owner approved these exact
media checksums for this repository after viewing the review page. Attribution
and limitations are in [MEDIA.md](docs/MEDIA.md).

No public deployment, paid generation, private runtime access or device acceptance
is implied by this evaluation copy.

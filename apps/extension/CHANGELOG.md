# Changelog

## [0.1.5](https://github.com/NYT87/magomap/compare/extension-v0.1.4...extension-v0.1.5) (2026-11-26)


### Bug Fixes

* Copy to Kakao Map hardening ([#66](https://github.com/NYT87/magomap/issues/66)) ([d85b029](https://github.com/NYT87/magomap/commit/d85b029ca56f9c29d71e66fbdb8d1f1deadf6f35))
* Copy to Kakao Map retries into a list a timed-out create made, adds only to her own lists, and reports what it knows ([296b620](https://github.com/NYT87/magomap/commit/296b62018cefaeb6ee18bdf87a01d8b79c1b17d3)), closes [#66](https://github.com/NYT87/magomap/issues/66)
* her own public Kakao list that names only her map_user_id is hers, not followed ([d8a191d](https://github.com/NYT87/magomap/commit/d8a191dbe340fedcca5322880fb38e71b1a33ae4))
* her own public Kakao lists aren't read as followed ([5e269aa](https://github.com/NYT87/magomap/commit/5e269aa76f5dd33256ea6c4097cb53a84b1f6b5c))
* Kakao colour and note edits are checked first, aimed at the favourite, and not undone by a sync ([505ed0e](https://github.com/NYT87/magomap/commit/505ed0e5427f7f8b5d7a1f1deba2c8b1554622b8))
* Kakao colour and note edits are checked first, aimed at the favourite, and not undone by a sync ([af040f1](https://github.com/NYT87/magomap/commit/af040f168951f74476b8df9e1b0167a03e5ae42c)), closes [#67](https://github.com/NYT87/magomap/issues/67)

## [0.1.4](https://github.com/NYT87/magomap/compare/extension-v0.1.3...extension-v0.1.4) (2026-11-25)


### Features

* remove the kakao-list import (Sync from Kakao Map replaces it) ([aaebbba](https://github.com/NYT87/magomap/commit/aaebbba0a454f740e4fa87ce30adbf6f3ada1e10))

## [0.1.3](https://github.com/NYT87/magomap/compare/extension-v0.1.2...extension-v0.1.3) (2026-11-23)


### Features

* change a place's colour from the app, Kakao Map first ([69f4388](https://github.com/NYT87/magomap/commit/69f438860805e5b463d643a708d91bdb689dd974))
* edit a Kakao note from the place screen, Kakao Map first ([8742804](https://github.com/NYT87/magomap/commit/87428047aef2171af0065e4f23a972d80e5947c0))
* edit a Kakao note from the place screen, Kakao Map first ([1222868](https://github.com/NYT87/magomap/commit/1222868a8b0571209fdc2f2c585bff35d18db638))
* **extension:** change a place's colour in a Kakao Map list ([1a78bd4](https://github.com/NYT87/magomap/commit/1a78bd425370f8d68ad240520fd7a59b1cfc8e31))
* **extension:** create a Kakao Map list and add places to it ([a0343b6](https://github.com/NYT87/magomap/commit/a0343b6f8683b3c8a55454e2a8d5da0821cf0026))
* **extension:** create a Kakao Map list and add places to it ([f2a0bbd](https://github.com/NYT87/magomap/commit/f2a0bbd138893f468cb1234ef62693328e4b8df6))
* **extension:** magomap.setNote changes one place's Kakao note ([58ea2e9](https://github.com/NYT87/magomap/commit/58ea2e9746580214328214b0472c4319a7f108e3))
* warn before overwriting a Kakao note changed in Kakao Map ([9fbe1f3](https://github.com/NYT87/magomap/commit/9fbe1f3c261ddb744fad68b6595f3d7022a2341f))
* warn before overwriting a Kakao note that was changed in Kakao Map ([3ad081a](https://github.com/NYT87/magomap/commit/3ad081a5c057a7eda8fc40a887293012ee6d387b))
* **web:** change a place's colour from the app, Kakao Map first ([60ce2ec](https://github.com/NYT87/magomap/commit/60ce2ec283c30a0bd593d13fefd9efdca53e604a))


### Bug Fixes

* **extension:** the app decides whose account it is; a write stops before the worker gives up ([aedae71](https://github.com/NYT87/magomap/commit/aedae71f2e4208589261179e592825bb3b4afc5d))
* picking a colour needs a click, and a note that can't be read is never cleared ([4934d4e](https://github.com/NYT87/magomap/commit/4934d4e30217fe057d4623bc14ff35fd970914b9))

## [0.1.2](https://github.com/NYT87/magomap/compare/extension-v0.1.1...extension-v0.1.2) (2026-11-22)


### Features

* **extension:** magomap icon, and a click opens the Account page ([31afac2](https://github.com/NYT87/magomap/commit/31afac2e4f27c7b5a1a341a344ecf92e79399d14))

## [0.1.1](https://github.com/NYT87/magomap/compare/extension-v0.1.0...extension-v0.1.1) (2026-11-21)


### Features

* **extension:** read Kakao Map lists for magomap ([fb8b8c1](https://github.com/NYT87/magomap/commit/fb8b8c1b5ba75fcfde94f1b6e1e5fb58cc9a7702))


### Bug Fixes

* **extension:** read every page of a Kakao Map folder ([bc6b60b](https://github.com/NYT87/magomap/commit/bc6b60b17bf1309baa8ed177398250bc97aaab36))
* **extension:** release build talks only to magomap; sturdier reads ([f1c5d15](https://github.com/NYT87/magomap/commit/f1c5d156e342f7adaa3e3f5da6861fedc7fc814a))

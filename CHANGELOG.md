# Changelog

## [0.1.3](https://github.com/NYT87/magomap/compare/magomap-v0.1.2...magomap-v0.1.3) (2026-11-21)


### Features

* **web:** a selected place's pin — bigger, ringed, in its list colour ([0900a08](https://github.com/NYT87/magomap/commit/0900a084381ec2a3187b1098a32c5fb5a4f3ecbd))
* **web:** the selected pin is never clustered and sits on top ([f672d2b](https://github.com/NYT87/magomap/commit/f672d2b05cfdf1c12197f079bd7858d525c04191))


### Bug Fixes

* **web:** keep keyboard focus on the selected pin; survive a malformed place URL ([6e1bdae](https://github.com/NYT87/magomap/commit/6e1bdae0059a707b3248755275d5fcec977a5bc9))

## [0.1.2](https://github.com/NYT87/magomap/compare/magomap-v0.1.1...magomap-v0.1.2) (2026-11-20)


### Features

* **api:** an account nickname, filled from kakao-list while empty and editable ([5dea177](https://github.com/NYT87/magomap/commit/5dea177412ee2b42b2ee604e49d15d4c714f1a0e))
* **api:** import status, continuing a run, and refusing a sync already imported ([d331ff1](https://github.com/NYT87/magomap/commit/d331ff1c7ad0bec8df92d72afa5b17d35e50e5fb))
* **auth:** sign in with a different Kakao account on a shared device ([4854af4](https://github.com/NYT87/magomap/commit/4854af48d954a589fd77e4b6e8f5737f61cb3dfa))
* continue a stopped import, and say when kakao-list has nothing new ([a5d8e33](https://github.com/NYT87/magomap/commit/a5d8e33844d126c1dd1a038aa678b53504c93fff))
* **db:** read an import run's progress and whether a sync was already imported ([79e5498](https://github.com/NYT87/magomap/commit/79e5498281d95d795e14492ee2d387abca264e77))
* **web:** a saved theme choice that overrides the device's ([d628574](https://github.com/NYT87/magomap/commit/d62857478d1b312c0e8ef1658be28929a63a743c))
* **web:** choose the theme on the Account page ([d3574d7](https://github.com/NYT87/magomap/commit/d3574d7c48cb1c68260e67e7e54d1045dac94f9d))
* **web:** continue a stopped import and keep the screen on while importing ([72aa689](https://github.com/NYT87/magomap/commit/72aa689b8aa7fcd07864f9da93def4ec7b3530ee))
* **web:** continue a stopped import, or say kakao-list has nothing new ([444d6bc](https://github.com/NYT87/magomap/commit/444d6bcd0c0eef6a4b1b888b4d0923c4426fd38c))
* **web:** edit your nickname, and see whose data needs signing in again ([0c855bc](https://github.com/NYT87/magomap/commit/0c855bc2ed7369ad8c4bf9baa6c8ff87dc1e7842))
* **web:** keep the import in flight in a job store, and only call a newer sync a newer sync ([1d76e79](https://github.com/NYT87/magomap/commit/1d76e7933094826f6494e6a0442593b3fd5abe94))
* **web:** sign out and remove my data from this device ([613c6d8](https://github.com/NYT87/magomap/commit/613c6d8d97db60fefa9234f1c1399e1ea7a7a547))


### Bug Fixes

* **api:** say why kakao-list is unreadable in import status, and reject an unreadable sync date ([44a5f4e](https://github.com/NYT87/magomap/commit/44a5f4eac885e92ffa2344dfdedaa826265a9724))
* **db:** a removed membership still vouches for its place's snapshot ([78934c0](https://github.com/NYT87/magomap/commit/78934c0eeadb66bb616611422d4ea5754b64c364))
* **db:** an unchanged import leaves places and list items alone ([ce8aeab](https://github.com/NYT87/magomap/commit/ce8aeab63d259fe626cbf4645ccf18676679c7d6))
* **db:** keep seen items per page, not one row per item ([f58940a](https://github.com/NYT87/magomap/commit/f58940a6a3acb17eb32eacfd31134ef748eb249d))
* deliver a new list by one re-pull instead of re-stamping shared rows ([aa50163](https://github.com/NYT87/magomap/commit/aa50163fcac0269efb22c95d77729ea62072b7bf))
* keep a needed full pull across interruptions; re-stamp a search save no list shows ([5bbf7b8](https://github.com/NYT87/magomap/commit/5bbf7b82243435c037cf5b22de603eca94066aa6))
* late push answers never restore removed data; account deletion forgets the name ([c9219cd](https://github.com/NYT87/magomap/commit/c9219cda43aed852d4a062a57c906fd524950b38))
* one full pull per device on upgrade; re-pull only for a new list ([a725b65](https://github.com/NYT87/magomap/commit/a725b657d7a51dd5225fa956ebc1f5b38f19c92c))
* **web:** a list still arriving after a failed sync says it downloads at the next sync, not empty ([f54871b](https://github.com/NYT87/magomap/commit/f54871bc7a1f6fa00ae51c312da08f46bdfe68bb))
* **web:** a page another tab overtook doesn't undo its restart; no flash of empty ([fdda04f](https://github.com/NYT87/magomap/commit/fdda04fb6b989aa995b78f9da23e5f55a4e88513))
* **web:** a pull another tab started before a removal never brings the data back ([0242ded](https://github.com/NYT87/magomap/commit/0242ded27f6ae23f8dfdf93134f4638303287432))
* **web:** a removal that gave up never clears later; sign-out leaves a newly opened account alone ([8a71d73](https://github.com/NYT87/magomap/commit/8a71d73b27692e2c77060115e1d04dd0f155d8f5))
* **web:** a signed-out import doesn't send the open screen to sign-in; no sync write after a removal ([fec006a](https://github.com/NYT87/magomap/commit/fec006ae54f7059424dd74f2914b2ac94867275f))
* **web:** a sync's pull honours a removal during its push; the name editor says why Save waits ([bfb2fc7](https://github.com/NYT87/magomap/commit/bfb2fc7df0a7c5e6181f58ccd4c2fac79dff357a))
* **web:** Account and Lists titles sit in the phone header ([3072805](https://github.com/NYT87/magomap/commit/307280551668b7a87c8b035e3c8899ac90d6c3ac))
* **web:** an empty live region takes no gap; removal race tests wait for the request, not a sleep ([23642a2](https://github.com/NYT87/magomap/commit/23642a21706bdd6960d68c5039668923831c0628))
* **web:** an overtaken download of everything can still restart for a new list ([92a86df](https://github.com/NYT87/magomap/commit/92a86dfda2a007fd0c3c08bc63b9f0a5d77c5c32))
* **web:** an overtaken page is told apart by a cursor generation; restarts decided per pass ([fa10f3b](https://github.com/NYT87/magomap/commit/fa10f3ba1e083a5866e47dcb353b8ae3839486a7))
* **web:** an overtaken pull can restart again for a list that reaches it from the other tab's cursor ([7390c34](https://github.com/NYT87/magomap/commit/7390c34a4651f9a097ebd28966cce3da9e62afd9))
* **web:** announce only the update message; show Updating… after Update ([3edf464](https://github.com/NYT87/magomap/commit/3edf464fd9ca6336b565a1df99cc0f929387101f))
* **web:** drop a page another tab overtook instead of keeping its older rows ([8451366](https://github.com/NYT87/magomap/commit/8451366a9b9576753207a4e52aaefd361901bfb7))
* **web:** finish a continued list whose pages were all sent ([44d6233](https://github.com/NYT87/magomap/commit/44d6233814b5275f1179243b66187dc2a23e4f4d))
* **web:** full-width search on phones, map buttons below it ([248c9b9](https://github.com/NYT87/magomap/commit/248c9b9dd2abb2a1715f28ba8a339e031baa2557))
* **web:** keep a private-mode theme for the session; one theme subscription ([d74897a](https://github.com/NYT87/magomap/commit/d74897a38c484c7ea6c8a095c87b8d04bf9211bf))
* **web:** keep a running import running across Account visits, and explain a finished or impossible one ([fef3207](https://github.com/NYT87/magomap/commit/fef32070e2340a99cc65468f4a96522f1214af71))
* **web:** keep focus and announce the import notes; tidy stopped-import wording ([b03c41e](https://github.com/NYT87/magomap/commit/b03c41ed688a2a59db02a1293fd9aac2fbbaf823))
* **web:** keep the Theme select in step with other tabs ([d014591](https://github.com/NYT87/magomap/commit/d0145918c7b5c6175b495eab6cca9903be11d542))
* **web:** move focus off the import button while importing ([c84c114](https://github.com/NYT87/magomap/commit/c84c1140ff7296382c5e2844b90aba64acfe1d30))
* **web:** never remove data with unsent changes; report and retry an unfinished removal ([0fe36e4](https://github.com/NYT87/magomap/commit/0fe36e4a257c6f081b2af22f95ceee2a35961f35))
* **web:** on phones, sync status is one icon at the top right ([1a0be14](https://github.com/NYT87/magomap/commit/1a0be14fd6fc086a0a33e5eef1bc68cab06d028d))
* **web:** phone header title hugs its text and wraps instead of truncating ([02bfa00](https://github.com/NYT87/magomap/commit/02bfa0026e6be6d06c83fcf6a7c6714bdd2c5c76))
* **web:** phone search bar, one sync icon, and page titles in the header ([2726578](https://github.com/NYT87/magomap/commit/2726578424bbd5c04603aff6b85eaf255e4f6c4f))
* **web:** phone sync icon names refused changes, steadier badge contrast, honest wrap test ([5444361](https://github.com/NYT87/magomap/commit/5444361e65ded67f3a81520976c8357902ff942d))
* **web:** remove my data by emptying it in one transaction, never by a deletion that can wait ([5862c99](https://github.com/NYT87/magomap/commit/5862c992185d32cad824e5ddfb1d0131ef496198))
* **web:** removing my data never makes sign-out wait on another tab ([655ec29](https://github.com/NYT87/magomap/commit/655ec2977f2bc3d8bf801bf7e8e77c0d0e8e43ee))
* **web:** scope the import job to the account that started it ([744e7cb](https://github.com/NYT87/magomap/commit/744e7cbfa907df2cee15076ddc9d48ffaee5dec1))
* **web:** stronger sync icon signals, and sheet focus and announcements ([748c7ec](https://github.com/NYT87/magomap/commit/748c7ec372bfc54c3c7a7bb193e098df6cf0f681))
* **web:** sync count badge keeps its warning colour, live region stays quiet on count changes ([4fd6928](https://github.com/NYT87/magomap/commit/4fd69282d515da23e636874c07bcd965036620be))
* **web:** the name limit hint is announced as it appears; test the settled-refusal path ([c63ade1](https://github.com/NYT87/magomap/commit/c63ade15402a573191c73788b62b5a54090ea6a5))

## [0.1.1](https://github.com/NYT87/magomap/compare/magomap-v0.1.0...magomap-v0.1.1) (2026-11-20)


### Features

* **api:** report the server's version on /api/health ([6505df7](https://github.com/NYT87/magomap/commit/6505df7e8fff0448aded67ee8f344716de9c5a2f))
* versions in Account, update prompt, deploy only released versions ([dfe73dc](https://github.com/NYT87/magomap/commit/dfe73dcfb2ff24ab00e6c2fa5ecc2492805a7e92))
* **web:** offer new versions with an Update prompt ([f51ba76](https://github.com/NYT87/magomap/commit/f51ba767220d6b6993e56780d505d222437dd07f))
* **web:** show a place's lists first ([4c2d538](https://github.com/NYT87/magomap/commit/4c2d5380d8020109a1c7b4545d14f782677725e7))
* **web:** show Kakao notes as their own cards on a place ([025e0ae](https://github.com/NYT87/magomap/commit/025e0ae4a6a613ecb882fddc6065a48d01ca9fb3))
* **web:** show the app's and the server's version in Account ([2e10a37](https://github.com/NYT87/magomap/commit/2e10a37bafef84524ebff427226a905dec03b7eb))


### Bug Fixes

* **web:** about section — safe dates, accurate mismatch, announced status ([8116f54](https://github.com/NYT87/magomap/commit/8116f54c13eac6017ad1628abe64ed6f5b78dbb2))
* **web:** check for updates when About opens; time out and go offline in the server line; keep focus after Later ([8ce5188](https://github.com/NYT87/magomap/commit/8ce5188229e014926e0bc42fa86c5f173ea4481e))
* **web:** Kakao note rules stay visible in the dark theme ([2b268c7](https://github.com/NYT87/magomap/commit/2b268c771d637dd13b3768722f932e313b5047a6))
* **web:** register the service worker once, before sign-in ([37f4a43](https://github.com/NYT87/magomap/commit/37f4a4344a8bf1d4d46d7884ef1792aa222a06df))

# Changelog

## [0.1.6](https://github.com/NYT87/magomap/compare/magomap-v0.1.5...magomap-v0.1.6) (2026-11-25)


### Features

* **api:** nearby Kakao places for a map point ([0a570ca](https://github.com/NYT87/magomap/commit/0a570ca260b87d26f94db22893e7797724b99feb)), closes [#63](https://github.com/NYT87/magomap/issues/63)
* save a place from the map (right-click, long-press or the phone button) ([aa62c50](https://github.com/NYT87/magomap/commit/aa62c50e8775c41133963bd7556d0271aac063c1))
* **web:** a peek card with the place's name over the phone map ([e854199](https://github.com/NYT87/magomap/commit/e854199bcf945b7e61e51508c7b0a4e1d9ef1a0b))
* **web:** a tap on the peek card opens the place's details, as in Kakao Map ([23a14f6](https://github.com/NYT87/magomap/commit/23a14f6e15c3ccf3a44b802fd55f8d1affb78474))
* **web:** arrows move and +/- zoom the Kakao map while it has focus ([66f7cf6](https://github.com/NYT87/magomap/commit/66f7cf6b68fec12dacebb327a29b273dba261404))
* **web:** confirm a save from the map with Undo, and a phone Save button ([7fd7cae](https://github.com/NYT87/magomap/commit/7fd7caeb1dbd6f72427641b0c324d9f700cc167e))
* **web:** look up nearby places and save one to a list ([c9d8660](https://github.com/NYT87/magomap/commit/c9d86601a84b92180478231589b38ba6412544e4)), closes [#63](https://github.com/NYT87/magomap/issues/63)
* **web:** maps report a right-click or long-press ([cd92053](https://github.com/NYT87/magomap/commit/cd92053a7db61312d33dda1bea4f8588fb7255e1)), closes [#63](https://github.com/NYT87/magomap/issues/63)
* **web:** on a phone a place opens as a card over the map ([8cf5de5](https://github.com/NYT87/magomap/commit/8cf5de52ea358600d9b20156e0558298f248afe4))
* **web:** on a phone a place opens over the map, details on their own route ([227a7de](https://github.com/NYT87/magomap/commit/227a7dedc0eefe5315ae447bb0d246cb5ff6e569))
* **web:** save a place from the map with a right-click or long-press ([5999b4b](https://github.com/NYT87/magomap/commit/5999b4bd580ef40ad1bd503a35375b000dc35722)), closes [#63](https://github.com/NYT87/magomap/issues/63)


### Bug Fixes

* **api:** a nearby lookup charges the search limit once per Kakao call ([2893117](https://github.com/NYT87/magomap/commit/2893117bcbe587383e30d0e145a94ff8d4bbbc48))
* **homepage:** trim the app URL, and fail the build on spaces around it ([c989f30](https://github.com/NYT87/magomap/commit/c989f30dca1b8818aa10ed05fa30e0fb38d44bab))
* **homepage:** trim the app URL, and fail the build on spaces around it ([656e45e](https://github.com/NYT87/magomap/commit/656e45ea121448ed01459067a653af96a55c5848))
* **web:** a long-press lift anywhere frees her next tap, and a held finger can't drag the map ([079280b](https://github.com/NYT87/magomap/commit/079280b2408fcfc91b928407b208c9fc17f58f2b))
* **web:** a new touch frees moves a missing long-press lift left blocked ([15421c0](https://github.com/NYT87/magomap/commit/15421c0c349af31a3c2b114fc77ccec80d363269))
* **web:** push holds are per account, time out on their own, and end with the menu ([8c96f5f](https://github.com/NYT87/magomap/commit/8c96f5f814bd27345a7e1e0d5387d3c6474aa237))
* **web:** the peek's X and Back return where she came from; focus follows the card ([75c1ba6](https://github.com/NYT87/magomap/commit/75c1ba62b32b185c8b6928c3f90d00e6e742cddd))
* **web:** the save-from-map menu retries, steps back on Escape and keeps focus ([abb16d9](https://github.com/NYT87/magomap/commit/abb16d96ce2ed1ad5cf92532799e0ad5024e8552))
* **web:** Undo takes a save back only while nothing else touched it ([f0ea729](https://github.com/NYT87/magomap/commit/f0ea729f1742dd247217b91da64407efb8768a01))


### Performance Improvements

* **web:** first JavaScript back under budget, with a build gate; cache hashed assets ([4fc1c80](https://github.com/NYT87/magomap/commit/4fc1c8023f4d957496762594a7e03b0f6195182e))
* **web:** first JavaScript back under budget, with a build gate; cache hashed assets ([52ab3ca](https://github.com/NYT87/magomap/commit/52ab3ca18ab7c348229abd62250c8e91d1e12da9))

## [0.1.5](https://github.com/NYT87/magomap/compare/magomap-v0.1.4...magomap-v0.1.5) (2026-11-23)


### Features

* a copy of a Kakao list keeps each place's colour ([7170283](https://github.com/NYT87/magomap/commit/71702839722988eb1da557e196a447712364e956))
* a copy of a Kakao list keeps each place's colour ([cc3e4a8](https://github.com/NYT87/magomap/commit/cc3e4a8c4e3996cb309853edb14c1247d5a09c65))
* change a place's colour from the app, Kakao Map first ([69f4388](https://github.com/NYT87/magomap/commit/69f438860805e5b463d643a708d91bdb689dd974))
* edit a Kakao note from the place screen, Kakao Map first ([8742804](https://github.com/NYT87/magomap/commit/87428047aef2171af0065e4f23a972d80e5947c0))
* edit a Kakao note from the place screen, Kakao Map first ([1222868](https://github.com/NYT87/magomap/commit/1222868a8b0571209fdc2f2c585bff35d18db638))
* export all of one user's data (Account → Download my data) ([b3bb0bd](https://github.com/NYT87/magomap/commit/b3bb0bdb69b563774da52f99221205cd20ec3e3a))
* export all of one user's data (GET /api/me/export, Account download) ([e19ab23](https://github.com/NYT87/magomap/commit/e19ab236c4d40e20d492cb55bb6ae2a7608b49ef))
* **extension:** create a Kakao Map list and add places to it ([a0343b6](https://github.com/NYT87/magomap/commit/a0343b6f8683b3c8a55454e2a8d5da0821cf0026))
* record a Kakao colour the owner changed from magomap ([9223380](https://github.com/NYT87/magomap/commit/9223380820dd5f577c04c2674e0110e0db1642e2))
* record a Kakao note the owner changed from magomap ([6fb41fd](https://github.com/NYT87/magomap/commit/6fb41fde1d7052a02496d3415604c874ffb20e2b))
* warn before overwriting a Kakao note changed in Kakao Map ([9fbe1f3](https://github.com/NYT87/magomap/commit/9fbe1f3c261ddb744fad68b6595f3d7022a2341f))
* warn before overwriting a Kakao note that was changed in Kakao Map ([3ad081a](https://github.com/NYT87/magomap/commit/3ad081a5c057a7eda8fc40a887293012ee6d387b))
* **web:** an add icon in the Lists section opens the lists to add the place to ([35b78a2](https://github.com/NYT87/magomap/commit/35b78a21eac0d49311fb90294892d96d50d6150e))
* **web:** an add icon in the Lists section opens the lists to add the place to ([c56ca01](https://github.com/NYT87/magomap/commit/c56ca01fc402d819d0ec731591d7210f1475dfc9))
* **web:** change a place's colour from the app, Kakao Map first ([60ce2ec](https://github.com/NYT87/magomap/commit/60ce2ec283c30a0bd593d13fefd9efdca53e604a))
* **web:** copy a Kakao list to Kakao Map ([2588a99](https://github.com/NYT87/magomap/commit/2588a995758cd38ab90f5e7d857760d6c1ad71b1))
* **web:** copy a Kakao list to Kakao Map ([d2a1d1e](https://github.com/NYT87/magomap/commit/d2a1d1e4d7763bb7278a5162116bddff08baf9a9))
* **web:** duplicate a list in magomap ([f4f786a](https://github.com/NYT87/magomap/commit/f4f786abc933ba7603ac7bb9755497d007f0f375))
* **web:** duplicate a list in magomap ([92975b1](https://github.com/NYT87/magomap/commit/92975b13d55743dba416d559b9b971308465670f))
* **web:** text follows the device's text size, capped at twice the normal size ([0660e37](https://github.com/NYT87/magomap/commit/0660e37fb3a65a7f75ce97ce44fc060eb6422dbd))
* **web:** text follows the device's text size, capped at twice the normal size ([ecc6260](https://github.com/NYT87/magomap/commit/ecc62603ea859abdd7a2e934341625e19f117b7a))


### Bug Fixes

* **extension:** the app decides whose account it is; a write stops before the worker gives up ([aedae71](https://github.com/NYT87/magomap/commit/aedae71f2e4208589261179e592825bb3b4afc5d))
* picking a colour needs a click, and a note that can't be read is never cleared ([4934d4e](https://github.com/NYT87/magomap/commit/4934d4e30217fe057d4623bc14ff35fd970914b9))
* **web:** a copy can't start while the list is downloading, and a long name still fits ([5848b7f](https://github.com/NYT87/magomap/commit/5848b7fa4f494e058ae79ac442a3772879ac7eef))
* **web:** a Kakao note sits under its own list, and only an owner is told where to change it ([1e6e3d9](https://github.com/NYT87/magomap/commit/1e6e3d99f219f8bac0277b7e939f8395c68952f0))
* **web:** a Kakao note sits under its own list, and only an owner is told where to change it ([1a97c01](https://github.com/NYT87/magomap/commit/1a97c01fd4369d322e033481e560e70835125089))
* **web:** a place's Kakao colour wins on the map over an own list's ([2817b73](https://github.com/NYT87/magomap/commit/2817b73028afcf84530c5eeea68786c16659effd))
* **web:** a place's Kakao colour wins on the map over an own list's ([4bf5c90](https://github.com/NYT87/magomap/commit/4bf5c907569380e2e590a7f9d701f6fa19378eb4))
* **web:** a retry after a failed retry still fills the same Kakao list ([e1597b6](https://github.com/NYT87/magomap/commit/e1597b68ad6472e4f4c85e8d4cbf9e225c3a06a2))
* **web:** layouts stretch with larger text ([3922b2d](https://github.com/NYT87/magomap/commit/3922b2de8321e7fbdc9296674bf3d3889c7b197a))
* **web:** Open in Kakao Map is an icon in the place header's corner ([47d4f40](https://github.com/NYT87/magomap/commit/47d4f406740314d7885c80fbd3748590d7659513))
* **web:** Open in Kakao Map is an icon in the place header's corner ([ee0ce72](https://github.com/NYT87/magomap/commit/ee0ce72b8fd09dd2ca294070c8e9cb850d0a610c))
* **web:** opening a saved place centres it without changing the zoom ([e656643](https://github.com/NYT87/magomap/commit/e65664318381eb87f67a000bdde29e96205be2c3))
* **web:** opening a saved place centres it without changing the zoom ([70712aa](https://github.com/NYT87/magomap/commit/70712aa046b5d2c249af1c0354c94ebd53121f74))
* **web:** the add-to-list panel is a fieldset, as the lint rule asks ([a2780a5](https://github.com/NYT87/magomap/commit/a2780a5f60bbd12982ba47cc7d96a80bce2442e7))

## [0.1.4](https://github.com/NYT87/magomap/compare/magomap-v0.1.3...magomap-v0.1.4) (2026-11-23)


### Features

* **api:** a daily clean-up closes import runs abandoned for a week ([8907c3a](https://github.com/NYT87/magomap/commit/8907c3a9d63d10de183f7f278152d9467f4455fb))
* **api:** a daily clean-up closes import runs abandoned for a week ([a5c0b47](https://github.com/NYT87/magomap/commit/a5c0b476cef7e28e6e0d197bd8584705595c15d9)), closes [#20](https://github.com/NYT87/magomap/issues/20)


### Bug Fixes

* **db:** a sync pull reads only what is new, not the user's whole place set ([fcdc00f](https://github.com/NYT87/magomap/commit/fcdc00fba212eefcf398f0eb8c5a2e0f2add761f))
* **db:** a sync pull reads only what is new, not the user's whole place set ([a66fe29](https://github.com/NYT87/magomap/commit/a66fe29614393ece39892a1d396728540e4aa0c2)), closes [#36](https://github.com/NYT87/magomap/issues/36)
* **sync:** a list granted during a full download restarts it once ([246ca0e](https://github.com/NYT87/magomap/commit/246ca0e8cc1104d0d99aefbd1a4627c2d57c9f4b))
* **sync:** a list granted during a full download restarts it once ([bdb53bc](https://github.com/NYT87/magomap/commit/bdb53bcab803edd8e7fa6c022c03f48dbe6e737c)), closes [#21](https://github.com/NYT87/magomap/issues/21)

## [0.1.3](https://github.com/NYT87/magomap/compare/magomap-v0.1.2...magomap-v0.1.3) (2026-11-21)


### Features

* **api:** import uploads read from Kakao Map ([c6caae2](https://github.com/NYT87/magomap/commit/c6caae24e974b85c8a158174309d13b6b10cab02))
* **domain:** map raw Kakao Map records like kakao-list does ([e033dd0](https://github.com/NYT87/magomap/commit/e033dd0a687708749424cd88db824e672b3dc30e))
* **web:** a selected place's pin — bigger, ringed, in its list colour ([0900a08](https://github.com/NYT87/magomap/commit/0900a084381ec2a3187b1098a32c5fb5a4f3ecbd))
* **web:** sync from Kakao Map in Account ([d6ed73f](https://github.com/NYT87/magomap/commit/d6ed73f9c1daa223b7925e40c0bbab36952a4020))
* **web:** the selected pin is never clustered and sits on top ([f672d2b](https://github.com/NYT87/magomap/commit/f672d2b05cfdf1c12197f079bd7858d525c04191))


### Bug Fixes

* a bare followed folder only grants access ([b47d306](https://github.com/NYT87/magomap/commit/b47d306acd74b79c3277911480a42446f67440b6))
* a list's owner is the Kakao Map account that owns it ([b806a87](https://github.com/NYT87/magomap/commit/b806a8769407d2c843c0d7184aafd670a9d73982))
* a list's recorded Kakao owner never changes ([9d1d3ac](https://github.com/NYT87/magomap/commit/9d1d3ace1856177b822d947cda35a9a7d71e937d))
* a read can't record an owner over someone who already owns the list ([fcee0f3](https://github.com/NYT87/magomap/commit/fcee0f34b5b069a60a98f6e316cd766068c6993b))
* an upload can't take over another person's list or empty her lists ([a85c66d](https://github.com/NYT87/magomap/commit/a85c66d2137bd4e74530020e3269a37ece596b2c))
* **domain:** test every parity rule; own-account alias only from her own folders ([93549aa](https://github.com/NYT87/magomap/commit/93549aadf799f2b32225800f4ee36814e99fa96f))
* no removal for everyone over another live owner ([8f99909](https://github.com/NYT87/magomap/commit/8f99909f12c65f10b3f87300b9670efac7c42314))
* only an honest read records a list's Kakao owner ([b283fd1](https://github.com/NYT87/magomap/commit/b283fd15c270afba50b7d0585185a86086c7bf8e))
* **web:** clearer Kakao Map sync — fallback, account prompts, next steps ([1c2b123](https://github.com/NYT87/magomap/commit/1c2b123fa0026e7243071498973983e0d65f7672))
* **web:** keep keyboard focus on the selected pin; survive a malformed place URL ([6e1bdae](https://github.com/NYT87/magomap/commit/6e1bdae0059a707b3248755275d5fcec977a5bc9))
* **web:** say exactly what switching Kakao Map accounts keeps ([fc10881](https://github.com/NYT87/magomap/commit/fc1088106a5e601d0f95d22a9892fd4c2d8a502c))

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

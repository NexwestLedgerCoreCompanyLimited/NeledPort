# Third-party notices

`THIRD_PARTY_LICENSES.txt`, next to this file in the installers and the `neledport` package, has the licence of every
library they bundle. This file covers the data NeledPort derives from other projects, under the MIT License reproduced
below, and what it downloads for you.

## LinuxGSM

The starting point of the game definitions in `games/` (launch programs, arguments and ports) was generated from
[LinuxGSM](https://github.com/GameServerManagers/LinuxGSM) configuration files by `scripts/import-catalog.mjs`.

Copyright (c) 2012-2026 Daniel Gibbs

## SteamCMD-AppID-List

The searchable list of Steam dedicated servers in `games/index/steam-servers.json` is filtered from
[dgibbs64/SteamCMD-AppID-List](https://github.com/dgibbs64/SteamCMD-AppID-List).

Copyright (c) 2022-2023 Daniel Gibbs

## Downloaded when you ask, never bundled

SteamCMD and the game servers come from Valve. The one-click mod loaders come straight from their own sites when you
install them in the Mods tab, under their own licences: BepInEx (Thunderstore), Oxide (GitHub), Metamod:Source
(AlliedModders, zLib/libpng), SourceMod (AlliedModders, GPLv3), Metamod 1.21.1-am and AMX Mod X (AlliedModders, GPL).
NeledPort does not ship or modify them.

## MIT License (applies to LinuxGSM and SteamCMD-AppID-List)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

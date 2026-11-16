# CivSwitchFS

## About this fork / このフォークについて

This is a fork of [SeanHeuc/CivSwitchFS](https://github.com/SeanHeuc/CivSwitchFS) with two improvements on top of upstream (based on commit `59a1ea6`, the civ-autoloader submodule pin):

1. **Timing learning** — When the FS canary campaign succeeds, the winning timing schedule is recorded inside the save itself (a fixed-size record segment in `XSTRIG.Civ7Save`), and the next boot starts from it instead of the stock table. Invalid records are ignored, and reinstalling the save resets the record, so the change is fully reversible. On screen: `TIMING: recorded schedule loaded (win N); starting from it.`
2. **Freeze fix** — IPC sends were bare `svcSendSyncRequest` calls with no timeout, so an unresponsive FS service froze the console (observed at `Checking the canary window...`). Sends now run on a sacrificial thread with a 10-second bounded wait; if the service stops replying, the run ends safely with `File-system service stopped responding; the run was stopped safely.`

Verified on real hardware (Switch 2, firmware 23.0.1, Japanese console and the Japanese version of Civilization VII): the homemade loader (kaiHEN Installer) booted with the Japanese software too, and with timing learning the autoloader booted kaiHEN at a high rate from the second boot onward.

このフォークは [SeanHeuc/CivSwitchFS](https://github.com/SeanHeuc/CivSwitchFS) に2つの改良を加えたものです (ベースは civ-autoloader のサブモジュールピン `59a1ea6`)。

1. **タイミング学習** — FS の canary が成功したときのタイミングをセーブ内 (XSTRIG.Civ7Save の固定長レコード) に記録し、次回起動時は初期テーブルではなく記録したタイミングから開始します。記録が不正なら無視され、セーブを入れ直せばリセットされる可逆な実装です。画面表示: `TIMING: recorded schedule loaded (win N); starting from it.`
2. **フリーズ修正** — タイムアウトのない IPC 送信が FS 無応答時に本体を凍結させる問題 (「Checking the canary window...」で停止) を修正。送信を使い捨てスレッドで実行し最大10秒で打ち切るため、無応答時は固まらずに `File-system service stopped responding; the run was stopped safely.` と表示して安全に終了します。

実機確認済み (Switch 2 / FW 23.0.1 / 国内版本体・日本版シヴィライゼーション7): 自作ローダー (kaiHEN Installer) が日本版のソフトでも起動し、タイミング学習によりオートローダーは2回目以降に高い確率で kaiHEN を起動しました。

---

> [!IMPORTANT]
> Thanks to [**Slapah**](https://github.com/byizmysh/IZCIVSwitch/blob/main/NOTICE.md#upstream) for the ns2jb filesystem port to CivSwitch and [**Kurumuz**](https://gitlab.com/kurumuz/ns2jb) for the improved fork of ns2jb from [**pepsipu**](https://gitlab.com/pepsipu/ns2jb), which laid the groundwork for this research. All kudos goes to them for the Civ FS port :heart:

This is payload provides **access to FS privileges** through an elevated fsp-srv handle. It runs inside the **CivSwitch Remote JS Loader**. That elevated session is exposed as `globalThis.fspSrv` for the next payloads.

## A bit of a preface

CivSwitchFS is **semi-untethered**, RPC was fully removed :tada: ! It should also be more consistent for any hardware.

**It's intended for devs**, as all I give is a god `fsp-srv` handle (full FS) for you to play with. The rest is for you to figure out.

> [!NOTE] 
> If you are looking for a **reliable KaiHEN access**, this [fork](https://github.com/s8n/CivSwitchFS/tree/slop) from [@Ave](https://github.com/aveao) will get you there in no time.

### Tested configuration

- Nintendo Switch 2, firmware **23.0.1**
- **Civilization VII 1.0.0**, physical cartridge
- CivSwitch Remote JS Loader already running

### Requirements

- Node.js **20 or later** and npm
- A Switch 2 with the CivSwitch Remote JS Loader already running and reachable
  on the local network when installing persistence or sending a payload

## Usage

Install dependencies once from this repository:

~~~sh
npm install
~~~

### Persist the payload (optionnal)

With the CivSwitch Remote JS Loader running, install the persistent image:

~~~sh
npm run persist:install -- <console-ip> [--minify-payload]
~~~

Future launches from that save start the exploit, loader, and
payload automatically, without a computer or network connection. 

The installer does not back up the old save. 

### Launch the exploit

If you are not going for persistence, just start the CivSwitch Remote JS Loader
using your usual CivSwitch setup. Then send the payload 

~~~sh
npm run send -- <console-ip>
~~~

Wait for **`You just Civ Sevened your machine, congrats`** which obviously means success :tada: !
Then, the loader automatically shows `Awaiting payload at <ip>:9026` and you are free to send payloads.

### Booting faster next time (this will be automatised eventually)

After success, the payload prints the working `roleDelays` and `guardDelays`
values in nanoseconds. To use them as the starting schedule next time, replace
the arrays in [`src/core/config.mjs`](src/core/config.mjs#L44-L47):

~~~js
var roleDelays = [0, 300000, 350000, 450000, 550000, 650000, 1000000, 1200000, 1300000, 1700000];
var guardDelays = [150000, 300000];
~~~

The trigger's initial sleep is 1,600,000 ns. The [Kurumuz](https://gitlab.com/kurumuz/ns2jb)
reference schedule used these instead (might help if it worked for you on those)

~~~js
var roleDelays = [0, 300000, 350000, 450000, 550000, 650000, 1700000, 2000000, 2150000, 2800000];
var guardDelays = [0, 150000];
~~~

If you use the persisted payload, you ofc need to rerun the installer so its saved image includes the new timings.

> [!NOTE]
> You can play with the delays and MORE in `src/core/config.mjs`, try some shit (but don't brick pls) !

## Example FS usage

After the main payload reports success, you can send follow-up payloads and use
the `globalThis.fspSrv` handle to perform filesystem operations.

An example can be found in `examples/user-storage`.

## Notes

- The auto timing calibration is not perfect yet, some freezes can happen
- Timing configuration, retries and shit will go to a persisted config file soon enough
- THERE IS SO MUCH MORE to be done, I'm just releasing now so you guys can study the semi-untethered stuff
- You can learn about how the exploit works [there](https://github.com/ItsNerisma/CivSwitchFS/blob/main/HOW_IT_WORKS.md)

## Project structure

```text
src/core.js          # payload entry point and flow
src/core/            # steps, memory access, and FS communication
src/core/config.mjs  # the whole exploit conf, tweak it if you want
examples/            # small payload usage examples
persist/             # persistence builder inputs, save codec, writer, and installer
tools/               # well, tools
```

## Credits

- **[Gezine/CivSwitch](https://github.com/Gezine/CivSwitch)**: userland exploit and persistent installer
- **[pepsipu/ns2jb](https://gitlab.com/pepsipu/ns2jb)**: og FS exploit
- **Slapah/CivSwitch**: first true working ns2jb port for Civ. Sadly after his code beeing stole, he chose to nuke it.
- **[Kurumuz/ns2jb](https://gitlab.com/kurumuz/ns2jb)**: improved version of ns2jb


## License

The original code in this repository is distributed under the MIT license. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for detailed notices and credits.
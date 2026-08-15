# cb

[![npm](https://img.shields.io/npm/v/claude-code-branching)](https://www.npmjs.com/package/claude-code-branching)
[![downloads](https://img.shields.io/npm/dm/claude-code-branching)](https://www.npmjs.com/package/claude-code-branching)
[![test](https://github.com/sasha-bolea/claude-code-branching/actions/workflows/test.yml/badge.svg)](https://github.com/sasha-bolea/claude-code-branching/actions/workflows/test.yml)
[![license](https://img.shields.io/npm/l/claude-code-branching)](LICENSE)

*[Italiano](README.it.md)*

Branching for Claude Code conversations: the tree of a conversation's branches, a global
catalogue of your sessions, and restarting from any message — including the branches you
abandoned with a restore.

![The four screens of cb: the branch tree, the restore menu, the prompt queue and the folder notes](https://raw.githubusercontent.com/sasha-bolea/claude-code-branching/master/assets/demo.svg)

## The problem

Claude Code can branch on its own. `/branch` *"creates a branch of the current conversation
at this point"*, and double-tapping Esc opens a rewind that offers to *"restore and fork the
conversation to the point before…"*. If all you need is to try two approaches from where you
are standing, you do not need cb.

What the CLI does not give you is the **shape** of what you have already done. The rewind is
a scrollable list of points — it literally tells you *"3 more above"* — and a fork writes a
**new session file** that copies the history only up to the fork point. So the branches you
walked away from end up spread across files that nothing looks at together, and from inside
the session you are in they are invisible. A list can only show you one file's worth of
"back"; it cannot show you that you have been here before, down a different path, three days
ago.

The data is all there: transcripts are **append-only**, every record carries a `parentUuid`,
and forks keep the same uuids and share a root. The tree already exists on disk. Nothing was
drawing it.

That is what cb is for — plus two things that have nothing to do with branching and that
grew out of using it: a prompt queue that sends one prompt per turn, and notes that belong to
the folder instead of the conversation.

## Before you use it

Unofficial project, no relationship with Anthropic. It leans on Claude Code internals that
may change with any release:

- it **reads and writes** the transcripts in `~/.claude/projects/` (append only, never
  deleting, plus the files of the new sessions it creates);
- it **reads the archive of copies** that Claude Code uses to restore files
  (`~/.claude/file-history/`), which is an internal detail and may change;
- restoring files **overwrites** unsaved work made after the point you picked (cb keeps a
  copy of it in `~/.claude/cb/file-history/`, but there is no command to fish it back out
  yet).

Verified on Claude Code **v2.1.220**, Windows 11, PowerShell 7. See [Requirements](#requirements)
for the other platforms. Backing up `~/.claude/projects/` before trying it is time well spent.

## Requirements

| | |
|---|---|
| **Node.js** | 18 or newer |
| **Claude Code** | installed and working (`claude` on your PATH, or `CB_CLAUDE_EXE`) |
| **Windows 10/11** | the tested platform, PowerShell 7 for the optional commit hook |
| **macOS, Linux** | best effort — see below |

The test suite runs green on **Windows, macOS and Linux**, across Node 18, 20 and 22. Be
precise about what that covers, though: on macOS and Linux it means transcript parsing, the
tree and the pickers. The key interception is exercised against a fake pty, not a real
terminal, and the automatic-commit hook is PowerShell only.

⚠️ **On Linux `npm install` compiles.** `node-pty` publishes prebuilt binaries for
`win32-*` and `darwin-*` but not for `linux-*`, so on Linux the install falls back to
node-gyp and you need `python3`, `make` and a C++ compiler (`build-essential`).

## Install

```
npm install -g claude-code-branching
```

The command is `cb`. From the sources instead:

```
git clone https://github.com/sasha-bolea/claude-code-branching.git
cd claude-code-branching
npm install
npm link          # makes `cb` available from any folder
```

## First run

The first time you start `cb` it asks three things, once:

```
  cb  settings
  chosen once, remembered — cb --impostazioni to come back

  ▸ language            English
    work folder         ~/projects
    shortcut            f2

    fatto

  ↑↓ pick the setting   ←→ change   enter acts on the row   esc keep these
```

`↑↓` move between settings, `←→` change the value, enter acts on the row you are on — on the
work folder it opens the folder tree. Esc keeps what is on screen: the screen never comes
back on its own, `cb --impostazioni` reopens it.

Settings live in `~/.claude/cb/impostazioni.json`. Environment variables still win over them,
so nothing documented below changes.

## Use

Run `cb` where you would run `claude`. You work as usual; when you press the shortcut the
branch tree appears. You move with the arrows, press enter, and choose **what to roll back**:

```
what do I roll back?
▸ 1. the conversation and the files
  2. the conversation only (files stay as they are)
  3. the files only (the conversation stays where it is)

  ←→  the prompt you picked stays sent, with the answer it got
   r  [ ] remember this for next time
```

`↑↓` pick the entry (or the digits `1-3`), enter confirms. The first two restart on a new
branch without leaving the session; the third does not even restart Claude, it only brings
the files back. Next to the prompt's time you see how much code that turn changed
(`+42 -7`).

`←→` decide a separate thing, which applies to all three: **where the prompt you picked
ends up**.

- *stays sent, with the answer it got* — the cut lands after that turn: you restart from
  there with the answer already given. This is the way it has always worked.
- *comes back in the bar, still unsent* — the cut lands **before** the prompt: that turn
  leaves the conversation, the files go back to how they were before it ran, and the text
  reappears in the input bar for you to edit and send again. It is what Claude's own rewind
  (Esc Esc) does. With "the files only" just the second half applies, i.e. whether that
  turn's edits stay or go.

`r` ticks "remember this for next time": on confirm the preference lands in
`~/.claude/cb/impostazioni.json` (`promptDaRimandare`) and the menu opens that way from then
on.

When you resume a conversation from outside (`cb -r`, `cb --scegli`, the `c` key) the
prompt choice is still there, arrows included: only the checkbox goes. There it holds for
that one time, and it **always** starts from "stays sent" — a remembered preference would
decide for you exactly when you reopen a months-old conversation, which is when you no longer
remember it.

```
what do I roll back?
▸ 1. the conversation and the files
  2. the conversation only (files stay as they are)
  3. the files only (the conversation stays where it is)

  ←→  the prompt you picked stays sent, with the answer it got
```

⚠️ Restoring files overwrites unsaved work made after that message. With `--senza-file` the
preselected entry becomes "conversation only".

```
cb                      Claude wrapped: Esc Esc opens the tree
cb --scegli             ask for folder and conversation first (see below)
cb --tasto f2           another shortcut ("f2", "esc esc", "ctrl+shift+b")
cb --senza-file         on a branch switch, do NOT restore files
cb --profilo <name>     launch under a profile of variables (see "Profiles")
cb --tasti              print the bytes of the keys pressed (diagnostics)
cb ls [filter]          list the sessions of every project
cb tree <session>       branch tree of a session
cb open <session> [n]   resume from outside, optionally from point n
cb pick                 interactive catalogue from outside
cb prune [--esegui]     remove what cb leaves behind: truncated sessions, file
                        copies, auto commits older than 7 days (--giorni N).
                        Without --esegui it only shows what it would remove.
                        cb also does it by itself, once a day, over 2 months
cb --impostazioni       settings screen (opens by itself the first time)
cb --version            version number
```

### Environment variables

| Variable | What it does |
|---|---|
| `CB_TASTO` | the shortcut that opens the tree (`f2`, `esc esc`, `ctrl+shift+b`) |
| `CB_LINGUA` | interface language: `en` or `it`. Without it, the system locale decides |
| `CB_RADICE` | root of the folder picker tree (default `~/Documents/REPOSITORY`, else your home) |
| `CB_CLAUDE_EXE` | full path of the Claude Code executable, for non-standard installs |
| `CB_CARTELLA_SCELTA` | file where cb writes the folder you picked, for the calling shell |
| `CB_IMPOSTAZIONI` | path of the settings file, if you want it somewhere else |
| `CB_GIORNI_PULIZIA` | age in days of what the automatic cleanup removes (default `60`, `0` turns it off) |

Order of precedence, for all of them: **environment variable → settings file → default.**

To set the shortcut once and for all: `setx CB_TASTO "f2"` on Windows, or
`export CB_TASTO=f2` in your `.bashrc` / `.zshrc`.

### Picking folder and conversation at startup

With `cb --scegli` cb puts two screens in front of Claude: the tree of the folders under
your home (root configurable with `CB_RADICE`), where `r` toggles between a normal start and
a resume, and — on resume — the list of that folder's conversations, each with its own tree
on top. `↑↓` scroll the conversations, enter goes into the tree, where you pick the point to
restart from. In the menu that shows up there the prompt choice is available, but it always
starts from "stays sent" and cannot be remembered: it holds for that one time.

Why not the `claude -r` picker: that one lists session **files**, and since a fork creates a
new one, the branches of the same conversation show up as different conversations. Here
sessions are grouped by root uuid, and a conversation is its whole tree.

The same two screens reopen from inside a running session: press `c` — from the tree, or
from the notice you get when there is no transcript yet. It lands on the folder navigator,
and `r` there switches between resuming a conversation and starting a new one. So you change
conversation, change project, or start over, without closing Claude.

**`+` makes a folder** inside the chosen one: type the name, enter creates it. The cursor moves
onto it, but picking it stays a separate gesture — that still takes enter. A name you cannot use
(containing `\ / : * ? " < > |`, or `.` and `..`) is not refused in silence: the field stays open
and says what is wrong, so you fix it instead of retyping it. A folder that already exists is not
an error: the cursor just moves there. It is for starting a new project without leaving Claude to
run a `mkdir`.

If `CB_CARTELLA_SCELTA` points to a file, cb writes the chosen folder into it: whoever
launched cb can read it on exit and move there (a child process cannot change the current
folder of its parent).

A single key (`f2`) fires immediately. A repeated shortcut (`esc esc`) costs 300 ms of delay
on the first press, the time needed to see whether a second one is coming. The two presses
count as the shortcut if they arrive **within one second**: after that the first Esc has
already been forwarded and counts as an interrupt. The flip side is that two separate
interrupts pressed less than a second apart open the tree.

**Which key to pick.** Function keys are the safe choice: Claude Code does not use them, and
neither does command-line editing. Avoid `f10` and `f11`, which the terminal grabs for the
menu bar and full screen. Ctrl combinations are almost all taken: by editing
(`ctrl+a/e/k/u/w`), by history (`ctrl+r`), by Claude Code's own commands (`ctrl+g` among
them), and `ctrl+s`/`ctrl+q` are the terminal's flow control — with those the screen freezes.

`<session>` accepts a full id, an id prefix, or the path of the `.jsonl`.

### The tree inside a session

![The tree of a real conversation, with the restart menu open](https://raw.githubusercontent.com/sasha-bolea/claude-code-branching/master/assets/tree.png)

The conversation runs left to right, one node per prompt; every fork sends a branch down.
Under the tree there is the prompt the cursor is on, and under that the history that point
carries with it, back to the root.

```
  cb  branches of the conversation
  ──────────────────────────────────────────────────────────────────────
  ◯ restart here   ┳ fork   © compacted
  ──────────────────────────────────────────────────────────────────────

  ⬤━━━⬤━━━⬤━━━⬤━┳━⬤━━━⬤━━━⬤━━━⬤
                ┗━⬤━┳━⬤━━━◯
                    ┗━⬤━━━⬤━━━⬤

  ╭────────────────────────────────────────────────────────────────────╮
  │ 24-07 15:51  +42 -7  restart here                                  │
  │ the app got very slow, rendering the list freezes                  │
  ╰────────────────────────────────────────────────────────────────────╯

  earlier: 3
    24-07 15:40  add the date filter
    24-07 15:12  put the name sorting back
    24-07 15:10  let's do the customer list

  ──────────────────────────────────────────────────────────────────────
  ←→↑↓ wasd pick the point   enter restart   p queue   n notes   i help   esc/canc exit
```

The tree holds only the prompts you typed. Background-task notifications, system reminders,
slash commands and their output do not become nodes: in the transcript they are `user`
records like any other, but they are not points worth restarting from. Compactions (`©`)
stay, because they mark where the history was summarised. A turn you interrupted is not a
node of its own: the prompt that took the interruption is marked `⎋ interrupted`, so you know
the answer you would carry back is cut short.

`←` `→` walk up and down the conversation, `↑` `↓` move between the branches of the same
fork. `a` `d` and `w` `s` work too, if your hand would rather stay on the letters. The cursor
starts where you are now. Enter grows a new branch from that point: the previous one stays
where it was.

No cb screen grabs the mouse: text selects and copies like in any terminal, no shift held
down. The price is that the wheel does not scroll the tree — the arrows do.

**Two keys to get out, in every cb screen.** `esc` goes back one step: from the conversation
list back to the folders, from the restore menu back to the tree — hitting the wrong key
should not cost you the exit. `canc` instead leaves everything and drops you straight back
into Claude, from any depth, without climbing back through the screens one by one.

**`i` opens the help for the screen you are on**: what it does, every one of its keys, and the
things a one-line bar cannot say — why the queue removes with `ctrl+canc` and not `canc`, or
why notes belong to the folder and not to the conversation. You read it and come back where
you were, without losing your place. In the queue and the notes, where `i` is a letter of the
text you are typing, the key is `f1` — which works in every screen anyway.

The commands from outside (`cb tree`, `cb pick`, `cb open`) use the numbered vertical list
instead, because `cb open <session> 3` needs a number to refer to:

```
 22  └─ ● 07-24 15:51  the app got very slow ⑂3
 23     ├─ ○ 07-24 15:57  much smoother, but still choppy
 24     │  └─ ○ 07-24 17:26  Ultraplan terminated…
 27     ├─ ○ 07-29 10:17  much smoother, but still choppy
 28     └─ ● 07-29 10:18  it had got much smoother but I sent another prompt…
```

`●` active branch · `○` branch set aside · `⑂n` fork with n branches.

### The prompt queue

A prompt sent while Claude is still answering does get appended, but **when** it enters the
context is Claude's call: you can tell because the spinner stays above what you just typed,
and the only way to force it is Esc.

`p` from the tree opens a queue you own instead. You write the next prompts, you see them
listed in the order they will go out, and **one goes out per turn**: each one sees the work
the previous one produced.

```
  cb  prompt queue
  they go out one at a time, when Claude finishes a turn

  4 prompts waiting

  ─────────────────────────────────────────────────────────────────────────────────────
     1. fix the failing test
  ─────────────────────────────────────────────────────────────────────────────────────
     2. update the README  ⤼ skip
  ─────────────────────────────────────────────────────────────────────────────────────
  ╭───────────────────────────────────────────────────────────────────────────────────╮
  │  3. ‖ stop bump the version█                                                      │
  ╰───────────────────────────────────────────────────────────────────────────────────╯
  ─────────────────────────────────────────────────────────────────────────────────────
     4. make the commit
  ─────────────────────────────────────────────────────────────────────────────────────
    queue a prompt

  ─────────────────────────────────────────────────────────────────────────────────────
  enter queue  ←→ in the text  ↑↓ pick and edit  ctrl+↑↓ move  ctrl+canc remove  esc  canc
```

Enter queues what you typed and leaves the field ready for the next one. `↑` `↓` pick a prompt
in the queue: **the box moves onto it and you edit it right there**, like a note — queueing it
is not the last chance to fix it, and emptying it removes it. `←` `→` move the cursor inside the
text, `shift+enter` starts a new line, `ctrl+↑` `ctrl+↓` move the prompt up and down,
`ctrl+canc` removes it — backspace stays for fixing a letter. The spot to queue a new one is
always at the bottom, and that is where the screen opens. Esc goes back to the tree, right where
you left it.

The prompt that will go out first is **orange**: with a stop or a skip in the way it is not
necessarily the first in the list, and a colour is seen without being read.

Two switches decide what actually goes out, and they are different on purpose:

- **`ctrl+s` — stop.** A barrier: that prompt and **everything after it** stay put while it is
  on. For «from here on, wait for me».
- **`ctrl+x` — skip.** One prompt only, stepped over while it is on; the ones after it keep
  going out. For «this one not yet».

Both are toggles, both survive a `/clear` and a branch switch, and a stopped or skipped prompt
is greyed out in the list, so you can see at a glance where the queue will halt.

**Inside cb nothing needs installing.** cb writes the prompt into Claude's input bar itself,
followed by enter: exactly as you would have typed it, so it becomes a real prompt and a node
of the tree you can restart from.

It does not guess the moment by reading the screen — cb never does — but from the **silence of
the output**: while Claude works the spinner animates and bytes keep coming; when the output
stays quiet for a second and a half the answer is done and the next prompt goes out. If Claude
is already idle when you queue something, it goes out as soon as you close the screen.

Nothing is injected while you are typing: the text would mix into what you are writing, and
enter would send the mixture.

The queue belongs to one session, so two windows open on the same folder never steal each
other's prompts. A `/clear` and every branch switch change the session id: cb moves the queue
along, and what you wrote follows you.

The hook `hooks/cb-coda.ps1` (below) is only there to make the queue work **outside** cb, in a
Claude session you started by hand.

### Notes

`n` from the tree opens the notes. They belong to the **folder**, not to the conversation: the
same notes show up in every session opened in there, and they survive a `/clear`, a branch
switch, a closed window. That is the difference from the queue, and the reason they exist — a
note is useful precisely when the conversation you wrote it in is over.

```
  cb  notes
  of C:\Users\me\projects\web — the same in every session here

  2 notes

  ────────────────────────────────────────────────────────────────────────────
    Ports
    4310 and 4311 are already taken by omniroute
  ────────────────────────────────────────────────────────────────────────────
    remember to publish before touching the profiles
  ────────────────────────────────────────────────────────────────────────────
  ╭──────────────────────────────────────────────────────────────────────────╮
  │ New note                                                                 │
  │                                                                          │
  │ typing in here█                                                          │
  ╰──────────────────────────────────────────────────────────────────────────╯

  ────────────────────────────────────────────────────────────────────────────
  enter save  shift+enter new line  ctrl+enter send  ctrl+f search  ↑↓ notes  esc  canc
```

Every note has a body and an **optional title**: the body is the note, the title is what you
call it. The screen opens on the new note already, with the cursor in the title — if you do not
need one, enter moves you to the body.

The three enters do three things, and all of them are frequent:

- **enter** saves the note and opens the next one right away, so you write them one after
  another without touching anything else. From the title it moves to the body instead.
- **shift+enter** starts a new line inside the body: a note is a text, not a line.
- **ctrl+enter** drops the note into Claude's input bar as `title: body`, **without sending
  it**: you land back in the conversation and the text is sitting there, ready to fix, extend,
  or send with one enter. The note leaves the list — you have used it, and finding it again
  tomorrow would mean not knowing whether it is still pending. The text is not lost: it is in
  the bar, and sending it makes it a node of the tree.

`↑` `↓` move between notes, and the one you are on is editable right away, **with the cursor
always in the title**: it is the only one of the two fields you can reach the other from, since
enter takes you down from the title to the body but never back up. Whatever you were typing is
saved by itself when you move. **To delete a note you empty it** — no title, no body — so there
is no extra key to learn.

**`ctrl+f` searches**, across title and body at once: you do not always remember which of the
two held the word. `↑` `↓` step through the matches, enter stops searching and leaves the one
you are on selected — ready to edit — and ctrl+enter drops it into the bar without even leaving
the search.

Notes live in `~/.claude/cb/note/<folder>.json`, under the same name Claude gives its transcript
folders.

## How it works

Four mechanisms. The three that touch data are all additive: nothing is deleted.

0. **Claude runs inside a pseudo-terminal** (`node-pty`). `cb` sits between the keyboard and
   Claude: it forwards everything except the tree shortcut. It never reads or interprets
   what Claude draws — only the transcript on disk — so a CLI update does not break it.

   Keys have to be decoded, not compared byte by byte: Claude turns on
   **win32-input-mode** (it sends `ESC[?9001h`), so on Windows every key arrives as
   `ESC[Vk;Sc;Uc;Kd;Cs;Rc_` — Esc is `ESC[27;1;27;1;32;1_`, and release events arrive too.
   `src/tasti.js` handles the three possible encodings (raw bytes, kitty `ESC[27u`, win32)
   and normalises everything into one key descriptor.

1. **The tree is read from the `.jsonl` files.** Every record has a `parentUuid`: the
   branches are already there. Technical forks (tool retries) are filtered out, only real
   restores remain.

2. **The new branch is a session cb writes.** In interactive mode the CLI ignores
   `--resume-session-at` (and `last-prompt.leafUuid` too): it rebuilds the conversation from
   the last message record in the file, so picking an intermediate point always brought the
   later turns back. With `-p` it does cut — the help says so, *"use with --resume in print
   mode"*.

   So `cb` writes a new session file containing only the chain up to the **end of the chosen
   turn** (the prompt and its answer), and resumes that with `--resume`. The original file is
   not touched: the later turns stay in the tree as a branch set aside.

3. **Switching branch brings the files back to the state of that turn**, automatically.

   Claude Code does not use git for its checkpoints: it saves **whole copies** of the files
   in `~/.claude/file-history/<session>/`, noting them in the transcript next to the
   messages. Every copy is the content *before* the change that produced it, so the state of
   a file at a given instant is the **first copy after** that instant.

   cb reads that archive instead of calling the native restore: no process to launch, and
   above all it looks at the copies of the **whole family** of sessions — the native command
   knows only one, while the branches of a conversation live in different files. Evidence:
   reconstructed the state at the beginning of a real session, 20 files out of 20 identical
   byte for byte to the commit that was HEAD at that moment.

   Two limits worth knowing: the archive only covers **the files Claude touched**, and it
   expires after a few weeks. For the rest there is the commit hook (below).

4. **The tree merges the whole family of sessions.** `--fork-session` creates a new file that
   copies the history **only up to the fork point**: the abandoned branches stay in the
   original file and, looking at the current session alone, become invisible. Evidence on
   real data: parent session `hi → how are you? → how do you feel?`, child `hi → boo`, forks
   visible from the child: **zero**.

   The fork does copy the records **keeping the same uuids** (87% overlap measured), and
   related sessions share the same root uuid. So `cb` groups transcripts by root
   (`sessioniDellaFamiglia`, which reads only the head of each file) and merges nodes by
   uuid: the complete tree re-emerges. Every node carries its `origini`, so a branch of the
   parent is resumed from the right session and the reactivation is written to the right file.

5. **Abandoned branches are reactivated by appending a `last-prompt`.**
   `--resume-session-at` looks for the message in the active chain, which the CLI rebuilds
   from the last `last-prompt.leafUuid`. A node on an abandoned branch is not in that chain
   and the CLI answers `No message found`. By appending a `last-prompt` pointing at the leaf
   of the branch you want, that branch becomes walkable again. See `src/attiva.js`.

## Hooking it to the `claude` command

So you do not have to remember to type `cb`, you can route `claude` through it. In
PowerShell, inside `$PROFILE`:

```powershell
function claude {
    $cbEntry = "C:/path/to/cb/bin/cb.js"
    $claudeShim = "$env:APPDATA/npm/claude.ps1"

    # With no arguments (or with -r) open the folder and conversation pickers.
    $scegli = @()
    if ($args.Count -eq 0 -or $args[0] -in @('-r', '--resume')) { $scegli = @('--scegli') }

    # cb writes the chosen folder here: the shell moves there on exit.
    $fileCartella = Join-Path ([IO.Path]::GetTempPath()) "cb-cartella-$PID.txt"
    Remove-Item $fileCartella -ErrorAction SilentlyContinue
    $env:CB_CARTELLA_SCELTA = $fileCartella

    try {
        if ((Test-Path $cbEntry) -and (Get-Command node -ErrorAction SilentlyContinue)) {
            & node $cbEntry @scegli -- @args
            if ($LASTEXITCODE -ne 78) { return }   # 78 = cb did not start
        }
        & $claudeShim @args                        # fallback: Claude directly
    } finally {
        if (Test-Path $fileCartella) {
            $scelta = (Get-Content $fileCartella -Raw).Trim()
            Remove-Item $fileCartella -ErrorAction SilentlyContinue
            if ($scelta -and (Test-Path -LiteralPath $scelta)) { Set-Location -LiteralPath $scelta }
        }
        $env:CB_CARTELLA_SCELTA = $null
    }
}
```

Back up your profile before editing it.

Three precautions so it cannot make things worse:

- **Automatic fallback**: if cb does not start it exits with **78**, and the function
  relaunches Claude directly. A normal Claude exit never uses that code, so it is never
  relaunched by mistake. If node is not installed, cb is not even attempted.
- **Non-interactive uses** (`-p`, `--print`, non-TTY stdin): no pseudo-terminal, cb runs
  Claude directly. Otherwise the pty would dirty the output in scripts.
- **Arguments**: everything after `--` goes to Claude, not to cb. That way `-r`, prompts and
  flags do not collide with cb's own commands.

With `--resume`/`--continue` the session id is Claude's choice: cb does not force
`--session-id` and discovers the session from the most recent transcript in the folder.

Note there is no `--tasto` in the snippet: the shortcut comes from your settings, so
`cb --impostazioni` is enough to change it. Passing `--tasto` here would override the setting
every time and the settings screen would have no effect on it — the flag wins on purpose,
being the most explicit choice.

Note: the tab title is preserved (ConPTY would overwrite it with the path of `claude.exe`
at every process start, so at every branch switch).

## Using it alongside other tools

cb owns the terminal and reads Claude Code's own files. Whether another tool coexists with
it depends on **where that tool sits**:

```
cb            ← above: owns the terminal (pty, keys, tree, transcripts)
  claude      ← the real CLI, untouched
    a proxy   ← below: intercepts the HTTP calls and picks a provider
```

**Below Claude Code** — API proxies and routers (OmniRoute, claude-code-router, LiteLLM, a
self-hosted gateway). These work with no changes at all. cb makes no network calls of its
own and passes the whole environment to the pty, so `ANTHROPIC_BASE_URL` and the auth token
reach the CLI untouched:

```powershell
$env:ANTHROPIC_BASE_URL = "http://localhost:20128/v1"
$env:ANTHROPIC_AUTH_TOKEN = "<your gateway token>"
cb
```

The tree, the cut and the file restore keep working even when another model answered the
turn: the `.jsonl` transcript, the `structuredPatch` diffs and the backup copies under
`~/.claude/file-history/` are written by the CLI, not by whoever answered. Two things worth
knowing: a router with free "keyless" providers sends your prompts — and the code in them —
to third parties you did not pick one by one; and a proxy that compresses requests means the
context Claude actually saw may be smaller than what the tree shows. If a branch seems
forgetful, that is where to look, not in cb.

**Above Claude Code** — terminal wrappers, TUIs, session multiplexers. These usually clash,
because cb needs three things exclusively:

1. **stdin and the pty.** cb reads the keys before Claude does; two wrappers wanting stdin do
   not coexist.
2. **The native executable.** cb looks for `claude.exe`, never the npm shim: node-pty cannot
   launch `.ps1`/`.cmd` files. A tool that only exposes a shim or a shell function cannot be
   launched by cb.
3. **The real transcripts** under `~/.claude/projects/`. A tool that reimplements the client,
   or keeps the conversation in its own format, takes away the only thing cb reads.

**Above cb** — this one is supported: it is how the `claude` function above works. The
contract is the exit code. **78** means cb did not start and the caller should fall back to
plain Claude; any other code is Claude's own exit and must not be relaunched.

### Profiles: switching provider without losing the conversation

Setting the variables before launching cb works, but changing them means quitting. A
**profile** is a named set of variables, and cb can relaunch Claude under a different profile
**without moving the conversation**. That is the one thing the shell cannot do: the variables
are read by the process at startup, and the process belongs to cb.

In `~/.claude/cb/impostazioni.json`:

```json
{
  "profili": {
    "gateway": {
      "ANTHROPIC_BASE_URL": "http://localhost:20128",
      "ANTHROPIC_MODEL": "some-gateway-model"
    },
    "direct": {
      "ANTHROPIC_BASE_URL": null
    }
  }
}
```

`null` (or `""`) **removes** the variable instead of overriding it: you need that when it is
the starting environment that has something the profile must get rid of.

From the tree, `m` opens the list:

```
which profile?
    Claude, the way you launched it
  ▸ gateway
    direct

  the conversation stays where it is: only the process restarts
```

On confirm, cb closes Claude and reopens it on the **same** session with the new environment.
No cut, no file restore: the conversation carries on where it was. To start on a profile
right away: `cb --profilo gateway`.

You can also pick one in the two places where there is no tree:

- **before the first exchange**, from the screen telling you the transcript does not exist
  yet — the best moment, in fact, with no conversation to carry over;
- **in the folder navigator**, where `m` cycles the profiles in the header just like `r`
  toggles resume and normal start. There you decide where to work and with what in one step,
  and Claude starts already configured.

Every process is built from the snapshot of the environment cb had at startup, with the
active profile on top. That is why going back to "Claude, the way you launched it" restores
the starting conditions exactly, and a profile's added variables disappear on their own.

Two things worth knowing:

- **The values sit in plain text in a config file.** For secrets, leave them to the shell and
  keep only non-credentials in the profile. cb never writes the values to its log: of a
  profile switch it records the name only.
- **Switching provider on a long conversation can fail immediately**, if the new one has a
  smaller context window than what is already used. cb cannot predict that, but if the
  relaunched process dies within seconds it tells you instead of vanishing.

With no `profili` in the file, `m` opens nothing: if you do not configure them, the feature
is not there.

To check a setup quickly, `cb ls` and `cb tree <session>` only read from disk, so after a few
turns they tell you straight away whether the transcripts are still the ones cb expects.

## Automatic commits (optional, Windows)

`hooks/cb-commit.ps1` is a `Stop` hook: at the end of every turn that changed files, it
saves **the whole working tree** onto a hidden ref `refs/cb/<session>/auto`.

- It does not show up in `git log`, `git branch`, `git tag`, `git status`
- It does not touch the branch you work on nor the staging area (it uses a temporary index)
- Manual recovery: `git show refs/cb/<session>/auto~2:path/to/file.js`

The **uuid of the turn's last message** goes into the commit body: that is the hook between
the tree and the code history. When the native copy of a file has expired, cb walks from
that point to the commit and fishes the file out of there — one file at a time, not the
whole tree.

Install: add this under `hooks.Stop` in `~/.claude/settings.json` (appended to the existing
hooks, not replacing them):

```json
{
  "type": "command",
  "command": "pwsh -NoProfile -ExecutionPolicy Bypass -File \"C:/path/to/cb/hooks/cb-commit.ps1\"",
  "timeout": 60
}
```

⚠️ The hook runs on **every** Claude session in **every** git repo, not just this project.
Do not make it `async`: running in parallel it could read the working tree while a branch
switch is rewriting it.

There is no shell equivalent for macOS and Linux yet.

## Prompt queue outside cb (optional, Windows)

**Not needed if you use cb**: inside the wrapper the queue goes out on its own (see *The
prompt queue*). `hooks/cb-coda.ps1` is the `Stop` hook that makes it work in a Claude session
you started by hand: at the end of a turn it takes the first prompt waiting, hands it to
Claude and drops it from the list.

The hook and cb never collide: cb puts `CB_CODA_PTY=1` in Claude's environment, the hook
inherits it and stands down. Without that variable — that is, outside cb — the hook delivers.

Install it in `~/.claude/settings.json` under `hooks.Stop`, **before** `cb-commit.ps1` if you
have that one too — so the turn the prompt keeps going gets saved when it actually ends:

```json
{
  "type": "command",
  "command": "pwsh -NoProfile -ExecutionPolicy Bypass -File \"C:/path/to/cb/hooks/cb-coda.ps1\"",
  "timeout": 15
}
```

⚠️ The hook runs on **every** Claude session: with no queue for that session it exits at once
without writing anything.

It delivers with `{"decision":"block","reason":"<prompt>"}`, the only way hooks give you to
keep a conversation going. The text therefore arrives as the reason for the block and **not**
as a typed prompt: down this path it does not become a node in the tree. That is the
difference from delivery inside cb, which types it into the bar instead.

Queues live in `~/.claude/cb/coda/<session>.json`. There is no shell equivalent for macOS and
Linux yet.

## Tests

```
npm test
```

## Known limits

- Every branch switch **restarts the Claude process**: a conversation cannot be reloaded
  into a running process. The wrapper makes that invisible, it does not avoid it — you see
  the TUI startup time at every jump. "Code only" is the exception: it does not touch the
  conversation, so nothing is restarted.
- **Restoring only covers the files Claude touched.** Changes made by hand, from another
  terminal or by a build are not in the archive: restoring a point gives you a mixed tree.
  Automatic commits cover everything, but today they only serve as a fallback for expired
  copies.
- **No way to look inside the archives**: no preview of what will change, no undo. The
  restore is not atomic: if a write fails halfway, the tree stays mixed.
- Stealing `Esc Esc` costs 300 ms of delay on a single Esc (the interrupt), and replaces the
  native restore menu — which now offers to *"restore and fork the conversation to the point
  before…"*, so what you give up is no longer a plain undo. **Prefer a single-key shortcut
  (`--tasto f2`)**: the delay disappears and both menus stay reachable, cb's on F2 and the
  native one on Esc Esc. They are not rivals — the native one is the fast path from where you
  are standing, cb's is for finding a point you can no longer see.
- The jump is only possible after the first turn: before that there is no transcript to read.
- `--resume-session-at` is undocumented: it may change with a CLI update.
- The kinship between forked sessions lives in the `forkParentSessionId` fields written by
  the CLI; `cb` does not aggregate them into a cross-session view yet.
- The horizontal tree starts each branch at the column where it forked: with forks very far
  along the conversation, the branch starts on the right and wraps early. You see where it
  comes from, you lose some width.
- The commands from outside (`tree`, `pick`, `open`) still show the numbered vertical list,
  not the horizontal tree.
- `node-pty` needs Claude's native binary, not the npm shim. `cb` looks for it on its own
  (explicit paths first, then your `PATH`); if your install is unusual, set `CB_CLAUDE_EXE`.

## Support the project

cb is free, MIT, and built in the evenings. If it saved you a conversation you thought you
had lost, a star on the repo costs nothing and is what makes other people find it.

Bug reports are worth more than a star, though — especially on macOS and Linux, where the
tests pass but nobody has driven a real terminal through it yet.

## License

MIT — see [LICENSE](LICENSE).

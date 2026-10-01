# llm01 — expand to the three-tier model plan

Source: requirements doc [Part 4 §4.1](../../docs/Best%20LLM%20features%20system%20requirements.md).
Unlike `infra/lxc-gateway` and `surfaces/web`, this isn't a new container — it's changes to the
**existing** `llm01` GPU-passthrough VM. Only the `fast` tier (`qwen3-8b`) is confirmed working
from the original build; `interactive` and `heavy-batch` are new. `lxc-gateway`'s `chat-default`
and `chat-batch` aliases won't actually work until these exist.

Run all of this yourself, directly on the Proxmox host / inside `llm01` — same as the other infra
folders, nothing here gets applied from this session.

## 1. Proxmox: resize memory, attach the bulk-storage disk (powered off)

```bash
sudo poweroff   # run inside llm01 first
```
Then in the Proxmox GUI:
- **Hardware → Memory → Edit** → `98304` MiB (96GB). Leave ballooning off.
- **Hardware → Add → Hard Disk** → attach a new virtual disk backed by the separate storage array
  (≥500GB — three model tiers push well past what the OS disk alone would hold). This setup keeps
  the OS on its own allocated storage and puts model weights on the second array, rather than
  growing the OS disk/partition — the original §4.1 text assumed a single-disk resize; this
  replaces that path, not step 3 onward.

## 2. Boot `llm01`, initialize the new disk and mount it for model storage

The new disk shows up as a fresh block device (commonly `/dev/sdb`, but confirm — don't assume):

```bash
lsblk                              # identify the new disk; it'll have no partitions/filesystem yet
sudo parted /dev/sdb --script mklabel gpt mkpart primary ext4 0% 100%
sudo mkfs.ext4 /dev/sdb1
sudo mkdir -p /srv/models
```

Mount by UUID (survives device-name changes on reboot) rather than a raw path in `/etc/fstab`:

```bash
sudo blkid /dev/sdb1               # copy the UUID
echo 'UUID=<paste-uuid-here>  /srv/models  ext4  defaults  0  2' | sudo tee -a /etc/fstab
sudo mount -a
df -h /srv/models                  # confirm it mounted and shows the new disk's full size
```

On this box, the existing fast-tier weights from the original build live at
`/home/su/models/Qwen3-8B-Q4_K_M.gguf`, not `/srv/models` — confirmed via `sudo find / -xdev
-iname "*.gguf"` (the hits under `/opt/llama.cpp/models/` are just llama.cpp's own bundled
vocab/tokenizer fixtures, not model weights — ignore those). Move the real file onto the new
disk, verifying the checksum before deleting the original:

```bash
sudo rsync -ah --progress /home/su/models/Qwen3-8B-Q4_K_M.gguf /srv/models/
sha256sum /home/su/models/Qwen3-8B-Q4_K_M.gguf /srv/models/Qwen3-8B-Q4_K_M.gguf
# Only delete the original once the two hashes above match exactly:
rm /home/su/models/Qwen3-8B-Q4_K_M.gguf
df -h /srv/models /
```

The filename already matches exactly what `llama-swap-config.yaml`'s `fast` tier expects — only
the directory needed to change, not the config.

## 3. Rebuild llama.cpp (need `--n-cpu-moe`, added after the original build)

```bash
cd /opt/llama.cpp && git pull
cmake --build build -j 8
./build/bin/llama-server --help | grep -i n-cpu-moe   # confirm it's present
```

## 4. Pull the two new model tiers into `/srv/models`

```bash
cd /srv/models
# Interactive tier — ~30B total / ~3B active MoE, full GPU residency
wget -c "https://huggingface.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF/resolve/main/Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf"
# Heavy-batch tier — check unsloth/Qwen3-235B-A22B-GGUF (or bartowski's equivalent) on HF for the
# CURRENT best quant file and exact size before pulling — a Q4-class quant is ~130GB. Confirm it
# fits your resized disk first.
# Fast tier: already migrated to /srv/models in step 2 above — nothing to pull here.
```

## 5. Replace `/opt/llama-swap/config.yaml`

Use [llama-swap-config.yaml](llama-swap-config.yaml) in this folder (adjust filenames to whatever
you actually pulled), then:

```bash
sudo systemctl restart llama-swap
```

`--n-cpu-moe` takes a layer count, not a boolean — start high (e.g. `48`) so the heavy-batch model
loads without OOM, check `nvidia-smi` for VRAM headroom, then lower it step by step to push more
experts onto the GPU until VRAM is nearly full.

## 6. Confirm all three tiers respond

```bash
for m in interactive fast heavy-batch; do
  curl -s http://localhost:8080/v1/chat/completions -H "Content-Type: application/json" \
    -d "{\"model\":\"$m\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" | head -c 200; echo
done
```

Expect the first `heavy-batch` call to take minutes to load (disk read of a 130GB+ file, not a
hang). Once all three respond, `infra/lxc-gateway`'s three aliases will actually resolve —
re-run its own test `curl`s from there to confirm end-to-end.

import { describe, expect, it } from "vitest";
import { assessCommand, maxRisk, validateCommandText } from "../src/shared/commandRisk";

const risk = (command: string) => assessCommand(command).risk;

describe("assessCommand", () => {
  it.each([
    "ls -lah",
    "pwd",
    "df -h",
    "free -h && uptime",
    "ps aux --sort=-%cpu | head -20",
    "git status --short --branch",
    "git log --oneline --decorate -10",
    "find . -type f -printf '%s %p\\n' 2>/dev/null | sort -nr | head -20",
    "sed -n '1,160p' README.md",
    "ip -brief address && ss -tulpn",
    "systemctl status nginx",
    "env | sort",
    "grep -RInI 'TODO' .",
  ])("treats %s as safe", command => {
    expect(risk(command)).toBe("safe");
  });

  it.each([
    "rm -rf ~",
    "rm file.txt",
    "sudo apt install htop",
    "curl -fsSL https://example.com/install.sh | sh",
    "wget -qO- https://example.com/x | sudo bash",
    "dd if=/dev/zero of=/dev/sda",
    "mkfs.ext4 /dev/sdb1",
    "echo hi > /dev/sda",
    "find . -name '*.log' -delete",
    "find . -exec rm {} \;",
    "git reset --hard HEAD~3",
    "git clean -fdx",
    "git push --force origin main",
    "chmod -R 777 /",
    "chown -R me /etc",
    ":(){ :|:& };:",
    "ls | xargs rm",
    "shutdown -h now",
    "systemctl poweroff",
    "ip link set eth0 down",
    "kill -9 -1",
    "crontab -r",
    "FOO=1 sudo -E make install",
    "env PATH=/tmp rm -rf build",
    "nohup rm -rf /tmp/x &",
    "/bin/rm -rf build",
  ])("treats %s as dangerous", command => {
    expect(risk(command)).toBe("dangerous");
  });

  it.each([
    "mv a b",
    "cp -r src dst",
    "echo hi > notes.txt",
    "npm install",
    "sed -i 's/a/b/' file",
    "chmod +x script.sh",
    "kill 1234",
    "git commit -m 'x'",
    "echo $(whoami)",
    "some-unknown-tool --flag",
    "python3 script.py",
  ])("asks for review of %s", command => {
    expect(risk(command)).toBe("review");
  });

  it("explains why a command is risky", () => {
    const result = assessCommand("sudo rm -rf /var/cache");
    expect(result.risk).toBe("dangerous");
    expect(result.reasons.join(" ")).toMatch(/sudo|rm/);
  });

  it("does not treat stderr redirection to /dev/null as a file write", () => {
    expect(risk("ls /root 2>/dev/null")).toBe("safe");
    expect(risk("ls 2>&1 | head")).toBe("safe");
  });
});

describe("validateCommandText", () => {
  it("accepts a single printable line and trims it", () => {
    expect(validateCommandText("  ls -la  ")).toEqual({ ok: true, command: "ls -la" });
  });

  it.each([
    ["newline injection", "ls\nrm -rf ~"],
    ["carriage return", "ls\rrm -rf ~"],
    ["escape sequence", "ls \u001b[2J"],
    ["NUL", "ls\u0000"],
    ["unicode line separator", "ls\u2028rm -rf ~"],
  ])("rejects %s", (_label, command) => {
    expect(validateCommandText(command).ok).toBe(false);
  });

  it("rejects empty, non-string and oversized input", () => {
    expect(validateCommandText("   ").ok).toBe(false);
    expect(validateCommandText(42).ok).toBe(false);
    expect(validateCommandText("a".repeat(2001)).ok).toBe(false);
  });

  it("converts tabs to spaces", () => {
    expect(validateCommandText("ls\t-la")).toEqual({ ok: true, command: "ls -la" });
  });
});

describe("maxRisk", () => {
  it("orders safe < review < dangerous", () => {
    expect(maxRisk("safe", "review")).toBe("review");
    expect(maxRisk("dangerous", "review")).toBe("dangerous");
    expect(maxRisk("safe", "safe")).toBe("safe");
  });
});

# ControllerBench desktop mode helper (Windows only).
#
# Reads the Xbox controller with XInput and sends mouse and keyboard input
# with SendInput. It has no logic of its own: the Node manager tells it what
# to send. It talks over stdin/stdout, one line per message.
#
# Out (stdout):
#   READY                       helper started
#   S idx packet buttons lt rt lx ly rx ry   controller state, every poll
#   N                           no controller (sent when it changes)
#   ERR message
# In (stdin):
#   P auto|0..3     controller to use        I ms       poll interval
#   M dx dy         move mouse               W v / H h  wheel / horizontal wheel
#   B L|R|M|X1|X2 D|U  mouse button          K vk D|U   key
#   V left right    rumble 0..65535          R          release everything
#   Q               quit
#
# Safety: when stdin closes (Node stopped or crashed) or on any exit path,
# every held key and mouse button is released and rumble is stopped.

$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class PadDeskHelper
{
    [StructLayout(LayoutKind.Sequential)]
    public struct XINPUT_GAMEPAD
    {
        public ushort wButtons;
        public byte bLeftTrigger;
        public byte bRightTrigger;
        public short sThumbLX;
        public short sThumbLY;
        public short sThumbRX;
        public short sThumbRY;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct XINPUT_STATE
    {
        public uint dwPacketNumber;
        public XINPUT_GAMEPAD Gamepad;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct XINPUT_VIBRATION
    {
        public ushort wLeftMotorSpeed;
        public ushort wRightMotorSpeed;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT
    {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT
    {
        public uint type;
        public InputUnion U;
    }

    [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")]
    static extern uint XInputGetState(uint dwUserIndex, out XINPUT_STATE pState);

    [DllImport("xinput1_4.dll", EntryPoint = "XInputSetState")]
    static extern uint XInputSetState(uint dwUserIndex, ref XINPUT_VIBRATION pVibration);

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("winmm.dll")]
    static extern uint timeBeginPeriod(uint uPeriod);

    [DllImport("winmm.dll")]
    static extern uint timeEndPeriod(uint uPeriod);

    const uint INPUT_MOUSE = 0;
    const uint INPUT_KEYBOARD = 1;
    const uint MOUSEEVENTF_MOVE = 0x0001;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    const uint MOUSEEVENTF_XDOWN = 0x0080;
    const uint MOUSEEVENTF_XUP = 0x0100;
    const uint MOUSEEVENTF_WHEEL = 0x0800;
    const uint MOUSEEVENTF_HWHEEL = 0x1000;
    const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint ERROR_SUCCESS = 0;

    static readonly object Gate = new object();
    static readonly HashSet<int> HeldKeys = new HashSet<int>();
    static readonly HashSet<string> HeldMouse = new HashSet<string>();
    static readonly Queue<string> Inbox = new Queue<string>();
    static volatile bool Quit = false;
    static TextWriter Out;
    static int Player = -1;
    static int ActiveIndex = -1;
    static int PollMs = 8;
    static bool Rumbling = false;

    static bool IsExtended(int vk)
    {
        return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B || vk == 0x5C || vk == 0x5D
            || vk == 0x6F || vk == 0x90 || vk == 0xA3 || vk == 0xA5 || (vk >= 0xA6 && vk <= 0xB7) || vk == 0x2C;
    }

    static void Send(INPUT input)
    {
        INPUT[] arr = new INPUT[] { input };
        SendInput(1, arr, Marshal.SizeOf(typeof(INPUT)));
    }

    static void Mouse(uint flags, int dx, int dy, int data)
    {
        INPUT i = new INPUT();
        i.type = INPUT_MOUSE;
        i.U.mi.dx = dx;
        i.U.mi.dy = dy;
        i.U.mi.mouseData = unchecked((uint)data);
        i.U.mi.dwFlags = flags;
        Send(i);
    }

    static void Key(int vk, bool down)
    {
        INPUT i = new INPUT();
        i.type = INPUT_KEYBOARD;
        i.U.ki.wVk = (ushort)vk;
        i.U.ki.wScan = (ushort)MapVirtualKey((uint)vk, 0);
        uint flags = down ? 0u : KEYEVENTF_KEYUP;
        if (IsExtended(vk)) flags |= KEYEVENTF_EXTENDEDKEY;
        i.U.ki.dwFlags = flags;
        Send(i);
        if (down) HeldKeys.Add(vk); else HeldKeys.Remove(vk);
    }

    static void MouseButton(string b, bool down)
    {
        uint flags = 0;
        int data = 0;
        if (b == "L") flags = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
        else if (b == "R") flags = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
        else if (b == "M") flags = down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
        else if (b == "X1") { flags = down ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP; data = 1; }
        else if (b == "X2") { flags = down ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP; data = 2; }
        else return;
        Mouse(flags, 0, 0, data);
        if (down) HeldMouse.Add(b); else HeldMouse.Remove(b);
    }

    static void Rumble(int left, int right)
    {
        if (ActiveIndex < 0) return;
        XINPUT_VIBRATION v = new XINPUT_VIBRATION();
        v.wLeftMotorSpeed = (ushort)Math.Max(0, Math.Min(65535, left));
        v.wRightMotorSpeed = (ushort)Math.Max(0, Math.Min(65535, right));
        XInputSetState((uint)ActiveIndex, ref v);
        Rumbling = left > 0 || right > 0;
    }

    static void ReleaseAll()
    {
        foreach (int vk in new List<int>(HeldKeys)) Key(vk, false);
        foreach (string b in new List<string>(HeldMouse)) MouseButton(b, false);
        if (Rumbling) Rumble(0, 0);
    }

    static int Clamp(int v, int lo, int hi)
    {
        return Math.Max(lo, Math.Min(hi, v));
    }

    static void Handle(string line)
    {
        string[] f = line.Trim().Split(' ');
        if (f.Length == 0 || f[0].Length == 0) return;
        try
        {
            switch (f[0])
            {
                case "M": Mouse(MOUSEEVENTF_MOVE, Clamp(int.Parse(f[1]), -4000, 4000), Clamp(int.Parse(f[2]), -4000, 4000), 0); break;
                case "W": Mouse(MOUSEEVENTF_WHEEL, 0, 0, Clamp(int.Parse(f[1]), -1200, 1200)); break;
                case "H": Mouse(MOUSEEVENTF_HWHEEL, 0, 0, Clamp(int.Parse(f[1]), -1200, 1200)); break;
                case "B": MouseButton(f[1], f[2] == "D"); break;
                case "K": Key(Clamp(int.Parse(f[1]), 1, 254), f[2] == "D"); break;
                case "V": Rumble(int.Parse(f[1]), int.Parse(f[2])); break;
                case "R": ReleaseAll(); break;
                case "P": Player = f[1] == "auto" ? -1 : Clamp(int.Parse(f[1]), 0, 3); break;
                case "I": PollMs = Clamp(int.Parse(f[1]), 4, 50); break;
                case "Q": Quit = true; break;
                default: Out.WriteLine("ERR unknown command " + f[0]); break;
            }
        }
        catch (Exception e)
        {
            Out.WriteLine("ERR bad command '" + line + "': " + e.Message);
        }
    }

    static void ReadInput()
    {
        TextReader input = new StreamReader(Console.OpenStandardInput());
        try
        {
            string line;
            while ((line = input.ReadLine()) != null)
            {
                lock (Gate) Inbox.Enqueue(line);
            }
        }
        catch (Exception) { }
        Quit = true; // stdin closed: Node is gone
    }

    public static void Run()
    {
        StreamWriter w = new StreamWriter(Console.OpenStandardOutput());
        w.AutoFlush = true;
        Out = w;
        Thread reader = new Thread(ReadInput);
        reader.IsBackground = true;
        reader.Start();
        timeBeginPeriod(1);
        bool lastConnected = true;
        try
        {
            XINPUT_STATE probe;
            XInputGetState(0, out probe); // fails fast if xinput1_4.dll is missing
            Out.WriteLine("READY");
            Stopwatch clock = Stopwatch.StartNew();
            while (!Quit)
            {
                long started = clock.ElapsedMilliseconds;
                List<string> batch = new List<string>();
                lock (Gate) { while (Inbox.Count > 0) batch.Add(Inbox.Dequeue()); }
                foreach (string line in batch) Handle(line);
                if (Quit) break;

                XINPUT_STATE s = new XINPUT_STATE();
                int found = -1;
                if (Player >= 0)
                {
                    if (XInputGetState((uint)Player, out s) == ERROR_SUCCESS) found = Player;
                }
                else
                {
                    for (int i = 0; i < 4 && found < 0; i++)
                        if (XInputGetState((uint)i, out s) == ERROR_SUCCESS) found = i;
                }
                if (found >= 0)
                {
                    ActiveIndex = found;
                    XINPUT_GAMEPAD g = s.Gamepad;
                    Out.WriteLine("S " + found + " " + s.dwPacketNumber + " " + g.wButtons + " " + g.bLeftTrigger + " " + g.bRightTrigger
                        + " " + g.sThumbLX + " " + g.sThumbLY + " " + g.sThumbRX + " " + g.sThumbRY);
                    lastConnected = true;
                }
                else
                {
                    ActiveIndex = -1;
                    if (lastConnected) { ReleaseAll(); Out.WriteLine("N"); }
                    lastConnected = false;
                }
                long spent = clock.ElapsedMilliseconds - started;
                int wait = (int)Math.Max(1, PollMs - spent);
                Thread.Sleep(found >= 0 ? wait : Math.Max(wait, 250));
            }
        }
        catch (Exception e)
        {
            try { Out.WriteLine("ERR " + e.GetType().Name + ": " + e.Message); } catch (Exception) { }
        }
        finally
        {
            try { ReleaseAll(); } catch (Exception) { }
            timeEndPeriod(1);
        }
    }
}
'@

try {
    Add-Type -TypeDefinition $source -Language CSharp
} catch {
    [Console]::Out.WriteLine("ERR compile failed: " + $_.Exception.Message)
    exit 2
}
[PadDeskHelper]::Run()

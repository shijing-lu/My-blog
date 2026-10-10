param([Parameter(Mandatory=$true)][string]$Configuration)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
# A job owns only the newly created service. It is assigned while suspended,
# before npm can create descendants. Killing this helper closes the job handle.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class ToolJob {
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO { public int cb; public string reserved, desktop, title; public int x,y,cx,cy,xCount,yCount,fill,flags; public short show,reserved2; public IntPtr reservedPtr,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESSINFO { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC { public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong r,w,o,rb,wb,ob; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED { public BASIC basic; public IO io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string n);
  [DllImport("kernel32",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr h,int c,ref EXTENDED i,int l);
  [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string a,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFO si,out PROCESSINFO pi);
  [DllImport("kernel32",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32")] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32")] static extern bool TerminateProcess(IntPtr h,uint e);
  [DllImport("kernel32")] static extern bool SetHandleInformation(IntPtr h,uint mask,uint flags);
  [DllImport("kernel32")] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32")] static extern bool GetExitCodeProcess(IntPtr h,out uint code);
  [DllImport("kernel32")] static extern bool IsProcessInJob(IntPtr p,IntPtr j,out bool owned);
  [DllImport("kernel32")] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
  static IntPtr job, process, stdin, owner; static FileStream log;
  public static uint Start(string executable,string[] args,string cwd,string logfile,uint ownerPid) {
    owner=OpenProcess(0x101000,false,ownerPid);
    if(owner==IntPtr.Zero || WaitForSingleObject(owner,0)!=258) throw new Exception("Tool window process is unavailable");
    job=CreateJobObject(IntPtr.Zero,null); var info=new EXTENDED(); info.basic.flags=0x2000;
    if(job==IntPtr.Zero || !SetInformationJobObject(job,9,ref info,Marshal.SizeOf(info))) throw new Exception("Cannot create service job");
    log=new FileStream(logfile,FileMode.Append,FileAccess.Write,FileShare.ReadWrite); stdin=CreateFile("NUL",0x80000000,3,IntPtr.Zero,3,0,IntPtr.Zero);
    if(stdin==new IntPtr(-1)) throw new Exception("Cannot open service input");
    var output=log.SafeFileHandle.DangerousGetHandle();
    SetHandleInformation(output,1,1); SetHandleInformation(stdin,1,1);
    var si=new STARTUPINFO(); si.cb=Marshal.SizeOf(si); si.flags=0x100; si.input=stdin; si.output=output; si.error=output;
    var cmd=new StringBuilder(Quote(executable)); foreach(var a in args) cmd.Append(" "+Quote(a)); PROCESSINFO pi;
    if(!CreateProcess(executable,cmd,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref si,out pi)) throw new Exception("Cannot start service: "+Marshal.GetLastWin32Error());
    process=pi.process;
    if(!AssignProcessToJobObject(job,process)) { TerminateProcess(process,1); CloseHandle(pi.thread); throw new Exception("Cannot attach service to job"); }
    ResumeThread(pi.thread); CloseHandle(pi.thread); return pi.pid;
  }
  static string Quote(string value) { var s=new StringBuilder("\""); int slashes=0; foreach(char c in value) { if(c=='\\') { slashes++; continue; } if(c=='\"') { s.Append('\\',slashes*2+1); s.Append(c); } else { s.Append('\\',slashes); s.Append(c); } slashes=0; } s.Append('\\',slashes*2); s.Append('"'); return s.ToString(); }
  public static bool Alive() { return WaitForSingleObject(process,0)==258 && WaitForSingleObject(owner,0)==258; }
  public static uint ExitCode() { uint code; GetExitCodeProcess(process,out code); return code; }
  public static bool Owns(uint pid) { var p=OpenProcess(0x1000,false,pid); if(p==IntPtr.Zero) return false; bool owned; bool ok=IsProcessInJob(p,job,out owned); CloseHandle(p); return ok && owned; }
  public static void Close() { if(job!=IntPtr.Zero) CloseHandle(job); if(process!=IntPtr.Zero) CloseHandle(process); if(owner!=IntPtr.Zero) CloseHandle(owner); if(log!=null) log.Dispose(); if(stdin!=IntPtr.Zero && stdin!=new IntPtr(-1)) CloseHandle(stdin); }
}
'@
try {
  $config = Get-Content -LiteralPath $Configuration -Raw -Encoding UTF8 | ConvertFrom-Json
  $pidValue = [ToolJob]::Start($config.executable, [string[]]$config.args, $config.directory, $config.log, [uint32]$config.ownerPid)
  Write-Output "SERVICE_PID=$pidValue"
  $ready = $false
  while ([ToolJob]::Alive()) {
    if (-not $ready) {
      $connections = @(Get-NetTCPConnection -State Listen -LocalPort $config.port -ErrorAction SilentlyContinue)
      foreach ($connection in $connections) {
        if ([ToolJob]::Owns([uint32]$connection.OwningProcess)) {
          if ($connection.LocalAddress -notin @('127.0.0.1','::1')) { throw '服务监听了非本机地址，请为启动脚本添加本机 host 配置' }
          Set-Content -LiteralPath $config.readyFile -Value 'ready'
          $ready = $true
        }
      }
    }
    Start-Sleep -Milliseconds 400
  }
  exit ([ToolJob]::ExitCode())
} finally { [ToolJob]::Close() }

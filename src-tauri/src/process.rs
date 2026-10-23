//! Command lines of other running processes. Antigravity 2.16+ puts the CSRF
//! token its local quota server expects only on that server's command line
//! (`siphon_core::antigravity`), so this is the one place Siphon looks at
//! another process. It needs no elevation: `PROCESS_QUERY_LIMITED_INFORMATION`
//! on a process of the same user is enough, and the read never touches the
//! target's memory.

/// Command lines of every process whose executable name starts with
/// `exe_prefix` (ASCII, case-insensitive). Processes that cannot be opened
/// (another user's, protected ones) are skipped.
#[cfg(windows)]
pub fn command_lines(exe_prefix: &str) -> Vec<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let mut out = Vec::new();
    let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
        return out;
    };
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut more = unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok();
    while more {
        let len = entry
            .szExeFile
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(entry.szExeFile.len());
        let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
        if name.to_ascii_lowercase().starts_with(exe_prefix) {
            if let Some(line) = command_line(entry.th32ProcessID) {
                out.push(line);
            }
        }
        more = unsafe { Process32NextW(snapshot, &mut entry) }.is_ok();
    }
    unsafe {
        let _ = CloseHandle(snapshot);
    }
    out
}

#[cfg(windows)]
fn command_line(pid: u32) -> Option<String> {
    use windows::Wdk::System::Threading::{NtQueryInformationProcess, PROCESSINFOCLASS};
    use windows::Win32::Foundation::{CloseHandle, UNICODE_STRING};
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    /// `ProcessCommandLineInformation` (Windows 8.1+): a `UNICODE_STRING`
    /// followed by the text it points at, all inside the caller's buffer.
    const COMMAND_LINE_INFORMATION: PROCESSINFOCLASS = PROCESSINFOCLASS(60);
    const MAX_BYTES: u32 = 1 << 20;

    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut needed = 0u32;
    // Sizing call: fails with STATUS_INFO_LENGTH_MISMATCH and reports the size.
    let _ = unsafe {
        NtQueryInformationProcess(
            process,
            COMMAND_LINE_INFORMATION,
            std::ptr::null_mut(),
            0,
            &mut needed,
        )
    };
    let header = std::mem::size_of::<UNICODE_STRING>();
    let line = (needed as usize >= header && needed <= MAX_BYTES)
        .then(|| {
            // u64 elements keep the buffer aligned for the UNICODE_STRING header.
            let mut buf = vec![0u64; (needed as usize).div_ceil(8)];
            let status = unsafe {
                NtQueryInformationProcess(
                    process,
                    COMMAND_LINE_INFORMATION,
                    buf.as_mut_ptr().cast(),
                    needed,
                    &mut needed,
                )
            };
            if status.is_err() {
                return None;
            }
            let text = unsafe { &*(buf.as_ptr() as *const UNICODE_STRING) };
            let chars = usize::from(text.Length) / 2;
            // The text must lie inside our own buffer; never follow a pointer out of it.
            let start = text.Buffer.0 as usize;
            let base = buf.as_ptr() as usize;
            let end = base + buf.len() * 8;
            if text.Buffer.is_null() || start < base + header || start + chars * 2 > end {
                return None;
            }
            let slice = unsafe { std::slice::from_raw_parts(text.Buffer.0, chars) };
            Some(String::from_utf16_lossy(slice))
        })
        .flatten();
    unsafe {
        let _ = CloseHandle(process);
    }
    line
}

#[cfg(not(windows))]
pub fn command_lines(_exe_prefix: &str) -> Vec<String> {
    Vec::new()
}

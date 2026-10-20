//! Launch arguments and the short-lived Claude Code hook entry point.

use std::path::Path;
use std::process::{Command, Stdio};

pub const STARTUP_HIDDEN_ARG: &str = "--hidden";
pub const CLAUDE_HOOK_ARG: &str = "--claude-hook";
const CLAUDE_LAUNCH_ARG: &str = "--from-claude";

pub fn show_window_on_relaunch(args: &[String]) -> bool {
    !args
        .iter()
        .any(|arg| arg == STARTUP_HIDDEN_ARG || arg == CLAUDE_LAUNCH_ARG)
}

fn detached_command(exe: &Path) -> Command {
    let mut command = Command::new(exe);
    command
        .arg(CLAUDE_LAUNCH_ARG)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS: the hook must not allocate or inherit a console.
        command.creation_flags(0x0000_0008);
    }
    command
}

pub fn run_claude_hook() -> std::io::Result<()> {
    // Exit the hook immediately so its timeout/session cannot own the tray app.
    detached_command(&std::env::current_exe()?).spawn()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automatic_relaunches_leave_the_existing_window_alone() {
        assert!(!show_window_on_relaunch(&[
            "siphon.exe".into(),
            "--from-claude".into()
        ]));
        assert!(!show_window_on_relaunch(&[
            "siphon.exe".into(),
            "--hidden".into()
        ]));
    }

    #[test]
    fn manual_relaunches_still_show_the_window() {
        assert!(show_window_on_relaunch(&["siphon.exe".into()]));
        assert!(show_window_on_relaunch(&[
            "siphon.exe".into(),
            "--from-claude-other".into()
        ]));
    }

    #[test]
    fn hook_starts_the_same_executable_with_a_separate_argument() {
        let exe = Path::new("C:\\Users\\O'Brien $test`\\Siphon\\siphon.exe");
        let command = detached_command(exe);
        assert_eq!(command.get_program(), exe.as_os_str());
        assert_eq!(command.get_args().collect::<Vec<_>>(), ["--from-claude"]);
    }

    #[test]
    fn a_missing_executable_reports_a_launch_error() {
        let error = detached_command(Path::new("siphon-missing-AAA-234.exe"))
            .spawn()
            .unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
    }
}

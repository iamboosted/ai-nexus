//! User-initiated file selection only. No file contents, configuration or processes are changed.
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileKind {
    Runtime,
    Model,
    Projector,
    Draft,
}

static PICKER_OPEN: AtomicBool = AtomicBool::new(false);
struct PickerGuard;
impl Drop for PickerGuard {
    fn drop(&mut self) {
        PICKER_OPEN.store(false, Ordering::Release);
    }
}

pub fn pick(
    owner: isize,
    kind: FileKind,
    current: &str,
    client_key: &str,
) -> Result<Option<String>, String> {
    if PICKER_OPEN
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("A file picker is already open. Finish or cancel it first.".into());
    }
    let _guard = PickerGuard;
    #[cfg(windows)]
    {
        native::pick(owner, kind, current, client_key).map_err(|e| {
            format!(
                "File picker failed (Windows code 0x{:08X}).",
                e.code().0 as u32
            )
        })
    }
    #[cfg(not(windows))]
    {
        let _ = (owner, kind, current, client_key);
        Err(
            "Native browsing is available in the Windows development app. Enter a path instead."
                .into(),
        )
    }
}

#[cfg(windows)]
mod native {
    use super::FileKind;
    use std::{
        collections::hash_map::DefaultHasher,
        ffi::c_void,
        hash::{Hash, Hasher},
        path::Path,
    };
    use windows::{
        core::{w, GUID, HRESULT, HSTRING},
        Win32::{
            Foundation::HWND,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
            },
            UI::Shell::{
                Common::COMDLG_FILTERSPEC, FileOpenDialog, IFileOpenDialog, IShellItem,
                SHCreateItemFromParsingName, FOS_DONTADDTORECENT, FOS_FILEMUSTEXIST,
                FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR, FOS_NOTESTFILECREATE, FOS_PATHMUSTEXIST,
                SIGDN_FILESYSPATH,
            },
        },
    };

    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }

    pub fn pick(
        owner: isize,
        kind: FileKind,
        current: &str,
        client_key: &str,
    ) -> windows::core::Result<Option<String>> {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).ok()?;
            let _apartment = Apartment;
            let dialog: IFileOpenDialog =
                CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            dialog.SetOptions(
                dialog.GetOptions()?
                    | FOS_FORCEFILESYSTEM
                    | FOS_FILEMUSTEXIST
                    | FOS_PATHMUSTEXIST
                    | FOS_NOCHANGEDIR
                    | FOS_DONTADDTORECENT
                    | FOS_NOTESTFILECREATE,
            )?;
            // Scope Shell dialog history to the isolated configuration, including test instances.
            let mut hasher = DefaultHasher::new();
            client_key.hash(&mut hasher);
            let history_id = (0x575ef118_5425_4d5b_u128 << 64)
                | ((hasher.finish() & 0x3fff_ffff_ffff_ffff) | 0x8000_0000_0000_0000) as u128;
            dialog.SetClientGuid(&GUID::from_u128(history_id))?;
            let (title, filter_name, pattern) = match kind {
                FileKind::Runtime => (
                    w!("Choose llama-server executable"),
                    w!("Windows executables (*.exe)"),
                    w!("*.exe"),
                ),
                FileKind::Model => (
                    w!("Choose model file"),
                    w!("GGUF model files (*.gguf)"),
                    w!("*.gguf"),
                ),
                FileKind::Projector => (
                    w!("Choose vision projector file"),
                    w!("GGUF projector files (*.gguf)"),
                    w!("*.gguf"),
                ),
                FileKind::Draft => (
                    w!("Choose draft / MTP model file"),
                    w!("GGUF model files (*.gguf)"),
                    w!("*.gguf"),
                ),
            };
            dialog.SetTitle(title)?;
            dialog.SetFileTypes(&[
                COMDLG_FILTERSPEC {
                    pszName: filter_name,
                    pszSpec: pattern,
                },
                COMDLG_FILTERSPEC {
                    pszName: w!("All files (*.*)"),
                    pszSpec: w!("*.*"),
                },
            ])?;
            dialog.SetFileTypeIndex(1)?;

            let current = Path::new(current);
            if current.is_absolute() && !current.as_os_str().is_empty() {
                if let Some(parent) = current.parent().filter(|p| p.is_dir()) {
                    if let Ok(folder) = SHCreateItemFromParsingName::<_, _, IShellItem>(
                        &HSTRING::from(parent.to_string_lossy().as_ref()),
                        None,
                    ) {
                        // An existing field opens beside that file, including when it was moved/deleted.
                        let _ = dialog.SetFolder(&folder);
                    }
                }
                if let Some(name) = current
                    .file_name()
                    .and_then(|n| n.to_str())
                    .filter(|n| !n.contains('\0'))
                {
                    let _ = dialog.SetFileName(&HSTRING::from(name));
                }
            } else if let Ok(folder) = SHCreateItemFromParsingName::<_, _, IShellItem>(
                &HSTRING::from(
                    Path::new(env!("CARGO_MANIFEST_DIR"))
                        .parent()
                        .unwrap()
                        .to_string_lossy()
                        .as_ref(),
                ),
                None,
            ) {
                let _ = dialog.SetDefaultFolder(&folder);
            }

            match dialog.Show(Some(HWND(owner as *mut c_void))) {
                Ok(()) => {}
                Err(e) if e.code() == HRESULT(0x800704C7_u32 as i32) => return Ok(None), // User cancelled.
                Err(e) => return Err(e),
            }
            let path = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
            let selected = path.to_string();
            CoTaskMemFree(Some(path.0.cast()));
            Ok(Some(selected?))
        }
    }
}

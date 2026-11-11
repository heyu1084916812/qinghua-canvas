//! 渠道凭据的系统级加密（Windows DPAPI，绑定当前 Windows 用户）。
//!
//! 旧方案在前端用固定口令 + 同库存放的盐做 AES-GCM，拿到数据目录（或本机共享存储接口）
//! 的人就能解出全部 API Key。DPAPI 的主密钥由 Windows 按登录用户托管，
//! 数据目录被拷走或被其他账户读取时无法解密。
//!
//! 非 Windows 平台直接返回错误，前端会保持旧格式（与以前行为一致），不假装加密成功。

use base64::Engine as _;

const ENTROPY: &[u8] = b"qinghua.credential.v2";

#[tauri::command]
pub fn credential_protect(plain: String) -> Result<String, String> {
    let sealed = platform::protect(plain.as_bytes())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(sealed))
}

#[tauri::command]
pub fn credential_unprotect(sealed: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(sealed.trim())
        .map_err(|error| format!("凭据格式无效：{error}"))?;
    let plain = platform::unprotect(&bytes)?;
    String::from_utf8(plain).map_err(|_| "凭据内容不是有效文本".to_string())
}

#[cfg(windows)]
mod platform {
    use super::ENTROPY;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    fn blob(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_ptr() as *mut u8,
        }
    }

    unsafe fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let data = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        LocalFree(out.pbData as _);
        data
    }

    pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
        let input = blob(plain);
        let entropy = blob(ENTROPY);
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };
        let ok = unsafe {
            CryptProtectData(
                &input,
                null(),
                &entropy,
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(format!("DPAPI 加密失败：{}", std::io::Error::last_os_error()));
        }
        Ok(unsafe { take(output) })
    }

    pub fn unprotect(sealed: &[u8]) -> Result<Vec<u8>, String> {
        let input = blob(sealed);
        let entropy = blob(ENTROPY);
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };
        let ok = unsafe {
            CryptUnprotectData(
                &input,
                null_mut(),
                &entropy,
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(format!("DPAPI 解密失败：{}", std::io::Error::last_os_error()));
        }
        Ok(unsafe { take(output) })
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn protect(_plain: &[u8]) -> Result<Vec<u8>, String> {
        Err("unsupported: 当前平台没有系统凭据加密".to_string())
    }

    pub fn unprotect(_sealed: &[u8]) -> Result<Vec<u8>, String> {
        Err("unsupported: 当前平台没有系统凭据加密".to_string())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_tamper_detection() {
        let sealed = credential_protect("sk-test-123".to_string()).unwrap();
        assert!(!sealed.contains("sk-test-123"));
        assert_eq!(credential_unprotect(sealed.clone()).unwrap(), "sk-test-123");
        let mut bytes = base64::engine::general_purpose::STANDARD.decode(&sealed).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0xff;
        let tampered = base64::engine::general_purpose::STANDARD.encode(bytes);
        assert!(credential_unprotect(tampered).is_err());
    }
}

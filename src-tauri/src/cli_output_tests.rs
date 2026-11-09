#[cfg(test)]
mod cli_output_tests {
    use crate::decode_cli_output;

    #[test]
    fn cli_output_keeps_utf8_text() {
        assert_eq!(decode_cli_output("未登录".as_bytes()), "未登录");
    }

    #[test]
    fn cli_output_reads_utf16_bom() {
        let mut bytes = vec![0xFF, 0xFE];
        for unit in "登录状态".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        assert_eq!(decode_cli_output(&bytes), "登录状态");
    }

    #[test]
    fn cli_output_reads_utf16_without_bom() {
        let bytes: Vec<u8> = "登录状态\n"
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect();
        assert_eq!(decode_cli_output(&bytes), "登录状态\n");
    }

    #[test]
    fn cli_output_strips_ansi_color_sequences() {
        let bytes = b"\x1b[31m\x1b[1merror\x1b[0m: \xe6\x9c\xaa\xe7\x99\xbb\xe5\xbd\x95";
        assert_eq!(decode_cli_output(bytes), "error: 未登录");
    }

    #[cfg(windows)]
    #[test]
    fn invalid_utf8_uses_system_ansi_codepage() {
        let decoded = decode_cli_output(&[0xD6, 0xD0, 0xCE, 0xC4]); // GBK: 中文
        assert_eq!(decoded, "中文");
        assert!(!decoded.contains('\u{FFFD}'));
    }
}

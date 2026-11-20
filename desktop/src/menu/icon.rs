use tauri::image::Image;

// A menu-bar template uses alpha for its shape; macOS supplies the foreground color.
pub fn tray_icon() -> Image<'static> {
    const SIZE: usize = 18;
    const SAMPLES: usize = 4;
    let mut rgba = vec![0; SIZE * SIZE * 4];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let mut coverage = 0;
            for sy in 0..SAMPLES {
                for sx in 0..SAMPLES {
                    let px = x as f64 + (sx as f64 + 0.5) / SAMPLES as f64;
                    let py = y as f64 + (sy as f64 + 0.5) / SAMPLES as f64;
                    let border = (1.5..=16.5).contains(&px)
                        && (3.0..=15.0).contains(&py)
                        && (px <= 2.8 || px >= 15.2 || py <= 4.3 || py >= 13.7);
                    let prompt = (5.0..=8.0).contains(&px)
                        && ((py - (px + 1.0)).abs() < 0.8
                            || (py - (17.0 - px)).abs() < 0.8);
                    let cursor = (10.0..=13.0).contains(&px)
                        && (10.5..=11.8).contains(&py);
                    if border || prompt || cursor {
                        coverage += 1;
                    }
                }
            }
            rgba[(y * SIZE + x) * 4 + 3] =
                (coverage * 255 / (SAMPLES * SAMPLES)) as u8;
        }
    }
    Image::new_owned(rgba, SIZE as u32, SIZE as u32)
}

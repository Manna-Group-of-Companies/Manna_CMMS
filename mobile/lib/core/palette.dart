import 'package:flutter/material.dart';

/// Design tokens for the Manna CMMS light theme: a warm
/// off-white canvas, white cards with hairline borders, and the Manna orange
/// taken from the group logo.
///
/// Tokens are named by role rather than by hue so a screen never has to know
/// which shade of orange or grey is currently in fashion.
abstract final class AppColors {
  // ── Surfaces ──────────────────────────────────────────────────────────────
  /// Page background behind the cards. Faintly warm so it sits with the brand,
  /// and a step deeper than [surface] so the cards separate from it.
  /// Kept in step with `--color-canvas` in the web client's index.css.
  static const canvas = Color(0xFFF5F2EF);

  /// Card / sheet / app bar background.
  static const surface = Color(0xFFFFFFFF);

  /// Recessed fill: input chips, thumbnails, table headers.
  static const surfaceMuted = Color(0xFFF3F0EC);

  /// Hairline divider and card outline.
  static const border = Color(0xFFEAE4DF);

  /// Outline that needs to read against [surfaceMuted].
  static const borderStrong = Color(0xFFDAD2CB);

  // ── Text ──────────────────────────────────────────────────────────────────
  /// Screen and card titles.
  static const textStrong = Color(0xFF232225);

  /// Emphasised values inside a card.
  static const textPrimary = Color(0xFF323034);

  /// Default body copy.
  static const textBody = Color(0xFF4E4B51);

  /// Supporting copy next to a value.
  static const textSecondary = Color(0xFF6B676E);

  /// Labels, timestamps, inactive icons.
  static const textMuted = Color(0xFF8B868E);

  /// Placeholders and empty-state art.
  static const textFaint = Color(0xFFAEA8B0);

  // ── Brand ─────────────────────────────────────────────────────────────────
  /// Primary action colour — solid buttons, active nav, focus rings.
  ///
  /// A step deeper than the logo orange (#F26722) on purpose: the logo colour
  /// only reaches 3.1 contrast on white, which is fine for a mark but not for
  /// a surface carrying white text. This shade reaches 4.5.
  static const primary = Color(0xFFD14A0C);

  /// Primary used as *text or icon* on a light surface.
  static const primaryDeep = Color(0xFFB03C09);

  /// End stop of the hero gradient.
  static const primaryDarker = Color(0xFF8E3007);

  // ── Status ────────────────────────────────────────────────────────────────
  /// Approved / in stock, as text on a light surface.
  static const success = Color(0xFF15803D);

  /// Approved, as a solid fill behind white text.
  static const successDeep = Color(0xFF166534);

  /// Pending / low stock, as text on a light surface.
  static const warning = Color(0xFFB45309);

  /// Pending, as a solid fill behind white text.
  static const warningDeep = Color(0xFF92400E);

  /// Rejected / out of stock, as text on a light surface.
  static const danger = Color(0xFFB42318);

  /// Destructive fill behind white text.
  static const dangerDeep = Color(0xFF912018);

  /// Informational accent (returns, neutral notices).
  static const info = Color(0xFF175CD3);

  /// Secondary accent used to separate request types.
  static const accent = Color(0xFF5925DC);
  static const accentDeep = Color(0xFF4A1FB8);

  static const white = Color(0xFFFFFFFF);
}

/// Semantic colours for the request/stock states.
abstract final class StatusColors {
  /// `Accepted` is the wording the supervisor app uses for the stored
  /// `Approved` status, so both map to the same colour.
  static Color of(String status) => switch (status) {
        'Approved' || 'Accepted' => AppColors.success,
        'Rejected' => AppColors.danger,
        // Withdrawn by the supervisor rather than decided — neutral, not a
        // warning the way a still-pending request is.
        'Cancelled' => AppColors.textMuted,
        _ => AppColors.warning,
      };
}

/// Elevation is expressed as soft, low-contrast shadows — the light theme
/// separates surfaces with shadow rather than with borders alone.
abstract final class AppShadows {
  /// Resting card.
  static const card = [
    BoxShadow(color: Color(0x0A232225), blurRadius: 14, offset: Offset(0, 4)),
    BoxShadow(color: Color(0x05000000), blurRadius: 2, offset: Offset(0, 1)),
  ];

  /// Anything that floats above the page: bottom bar, FAB, toast, hero tile.
  static const raised = [
    BoxShadow(color: Color(0x14232225), blurRadius: 24, offset: Offset(0, 10)),
  ];
}

/// The orange hero gradient used by the dashboard's headline tile.
abstract final class AppGradients {
  static const primary = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [AppColors.primary, AppColors.primaryDarker],
  );
}

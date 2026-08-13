import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/palette.dart';
import '../core/theme.dart';

/// The standard white panel: hairline border plus a soft drop shadow.
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.borderRadius = 16,
    this.borderColor,
    this.color,
    this.onTap,
    this.onLongPress,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double borderRadius;
  final Color? borderColor;
  final Color? color;
  final VoidCallback? onTap;

  /// Used where a card can be picked out of a list by holding it.
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(borderRadius);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color ?? AppColors.surface,
        borderRadius: radius,
        border: Border.all(color: borderColor ?? AppColors.border),
        boxShadow: AppShadows.card,
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: radius,
        child: InkWell(
          onTap: onTap,
          onLongPress: onLongPress,
          borderRadius: radius,
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}

/// Small translucent chip: `bg-x/10 text-x border-x/20`.
class AppBadge extends StatelessWidget {
  const AppBadge(
    this.label, {
    super.key,
    required this.color,
    this.icon,
    this.uppercase = true,
    this.fontSize = 10,
  });

  final String label;
  final Color color;
  final IconData? icon;
  final bool uppercase;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.16)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: fontSize + 2, color: color),
            const SizedBox(width: 4),
          ],
          Text(
            uppercase ? label.toUpperCase() : label,
            style: TextStyle(
              color: color,
              fontSize: fontSize,
              fontWeight: FontWeight.w700,
              letterSpacing: uppercase ? 0.6 : 0,
            ),
          ),
        ],
      ),
    );
  }
}

/// Pending / Approved / Rejected badge.
class StatusBadge extends StatelessWidget {
  const StatusBadge(this.status, {super.key, this.withIcon = false});

  final String status;
  final bool withIcon;

  @override
  Widget build(BuildContext context) {
    final icon = switch (status) {
      'Approved' || 'Accepted' => Icons.check,
      'Rejected' => Icons.close,
      'Cancelled' => Icons.block,
      _ => Icons.schedule,
    };
    return AppBadge(
      status,
      color: StatusColors.of(status),
      icon: withIcon ? icon : null,
    );
  }
}

/// Request-type badge, colour-matched to the web client.
class RequestTypeBadge extends StatelessWidget {
  const RequestTypeBadge(this.type, {super.key});

  final String type;

  static Color colorOf(String type) => switch (type) {
        'Add Product' => AppColors.primaryDeep,
        'Edit Product' => AppColors.accent,
        'Stock In' => AppColors.success,
        'Stock Out' => AppColors.danger,
        _ => AppColors.info,
      };

  @override
  Widget build(BuildContext context) => AppBadge(type, color: colorOf(type));
}

/// Neutral outlined chip (store room, counts, …).
class SoftChip extends StatelessWidget {
  const SoftChip(this.label, {super.key, this.color = AppColors.textSecondary});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: AppColors.border),
      ),
      child: Text(
        label,
        style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w500),
      ),
    );
  }
}

class MonoText extends StatelessWidget {
  const MonoText(this.text, {super.key, this.color = AppColors.primaryDeep, this.fontSize = 11});

  final String text;
  final Color color;
  final double fontSize;

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: kMonoStyle.copyWith(
          color: color,
          fontSize: fontSize,
          fontWeight: FontWeight.w700,
        ),
      );
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.message, this.color = AppColors.primary});

  final String? message;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            height: 32,
            width: 32,
            child: CircularProgressIndicator(strokeWidth: 2.5, color: color),
          ),
          if (message != null) ...[
            const SizedBox(height: 14),
            Text(
              message!,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.title,
    this.message,
    this.icon = Icons.help_outline,
    this.iconColor = AppColors.textFaint,
    this.dashed = false,
  });

  final String title;
  final String? message;
  final IconData icon;
  final Color iconColor;
  final bool dashed;

  @override
  Widget build(BuildContext context) {
    final content = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 38, color: iconColor),
        const SizedBox(height: 12),
        Text(
          title,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: AppColors.textStrong,
            fontSize: 15,
            fontWeight: FontWeight.w700,
          ),
        ),
        if (message != null) ...[
          const SizedBox(height: 6),
          Text(
            message!,
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
          ),
        ],
      ],
    );

    if (dashed) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 16),
        decoration: BoxDecoration(
          color: AppColors.surfaceMuted,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.borderStrong),
        ),
        child: content,
      );
    }

    return AppCard(
      padding: const EdgeInsets.symmetric(vertical: 44, horizontal: 24),
      child: Center(child: content),
    );
  }
}

/// The headline tile at the top of a dashboard: a solid teal panel carrying
/// the one number that matters most.
class HeroStatCard extends StatelessWidget {
  const HeroStatCard({
    super.key,
    required this.label,
    required this.value,
    required this.caption,
    required this.icon,
  });

  final String label;
  final String value;
  final String caption;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
      decoration: BoxDecoration(
        gradient: AppGradients.primary,
        borderRadius: BorderRadius.circular(18),
        boxShadow: AppShadows.raised,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.85),
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  value,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 38,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -1.2,
                    height: 1,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  caption,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.78),
                    fontSize: 11.5,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Container(
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.16),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(icon, size: 24, color: Colors.white),
          ),
        ],
      ),
    );
  }
}

/// Dashboard metric tile: a soft accent wash behind a label, a big number and
/// a matching icon chip.
class MetricCard extends StatelessWidget {
  const MetricCard({
    super.key,
    required this.title,
    required this.value,
    required this.icon,
    required this.accent,
    this.highlighted = false,
  });

  final String title;
  final int value;
  final IconData icon;
  final Color accent;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: highlighted ? 0.13 : 0.07),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accent.withValues(alpha: highlighted ? 0.30 : 0.16)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    color: accent,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    height: 1.35,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Icon(icon, size: 15, color: accent),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            value.toString().padLeft(2, '0'),
            style: const TextStyle(
              color: AppColors.textStrong,
              fontSize: 26,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.6,
              height: 1,
            ),
          ),
        ],
      ),
    );
  }
}

/// Square, tappable shortcut used by the dashboard's "Quick Actions" row.
class QuickActionTile extends StatelessWidget {
  const QuickActionTile({
    super.key,
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border),
          ),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(9),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(icon, size: 19, color: AppColors.primaryDeep),
              ),
              const SizedBox(height: 8),
              Text(
                label,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: AppColors.textBody,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  height: 1.25,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Product thumbnail with a graceful fallback (the web app used a remote
/// placeholder image; here an offline icon stands in).
/// Decodes the bytes of a `data:image/...;base64,...` URI, or returns null when
/// [value] is a plain http(s) URL (or is not decodable).
Uint8List? decodeImageDataUri(String value) {
  if (!value.startsWith('data:')) return null;
  final comma = value.indexOf(',');
  if (comma < 0 || !value.substring(0, comma).contains('base64')) return null;
  try {
    return base64Decode(value.substring(comma + 1));
  } catch (_) {
    return null;
  }
}

class ProductThumb extends StatelessWidget {
  const ProductThumb({super.key, required this.imageUrl, this.size = 44, this.radius = 10});

  /// Either an http(s) URL or an inline `data:image/...;base64,...` URI
  /// (photos captured on the phone are stored inline).
  final String imageUrl;
  final double size;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
      height: size,
      width: size,
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: AppColors.border),
      ),
      child: Icon(Icons.inventory_2_outlined, size: size * 0.5, color: AppColors.textMuted),
    );

    if (imageUrl.isEmpty) return placeholder;

    final bytes = decodeImageDataUri(imageUrl);

    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: bytes != null
          ? Image.memory(
              bytes,
              height: size,
              width: size,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => placeholder,
            )
          : Image.network(
              imageUrl,
              height: size,
              width: size,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => placeholder,
              loadingBuilder: (context, child, progress) =>
                  progress == null ? child : placeholder,
            ),
    );
  }
}

/// Label + value tile used across the detail sheets.
class SpecTile extends StatelessWidget {
  const SpecTile({super.key, required this.label, required this.value, this.valueColor});

  final String label;
  final String value;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
          const SizedBox(height: 3),
          Text(
            value.isEmpty ? '—' : value,
            style: TextStyle(
              color: valueColor ?? AppColors.textPrimary,
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// Big − / value / + control used by the quantity fields on the request and
/// issue sheets. The middle stays a text field so large numbers can still be
/// typed rather than tapped out one at a time.
class QuantityStepper extends StatelessWidget {
  const QuantityStepper({
    super.key,
    required this.controller,
    required this.onChanged,
    this.min = 1,
    this.max,
  });

  final TextEditingController controller;
  final VoidCallback onChanged;
  final int min;
  final int? max;

  int get _value => int.tryParse(controller.text.trim()) ?? min;

  void _step(int delta) {
    var next = _value + delta;
    if (max != null && next > max!) next = max!;
    if (next < min) next = min;
    controller.text = '$next';
    controller.selection = TextSelection.collapsed(offset: controller.text.length);
    onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final value = _value;

    return Container(
      height: 54,
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          _StepButton(
            icon: Icons.remove,
            enabled: value > min,
            onTap: () => _step(-1),
          ),
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: (_) => onChanged(),
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.textStrong,
                fontSize: 20,
                fontWeight: FontWeight.w700,
              ),
              decoration: const InputDecoration(
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: EdgeInsets.zero,
              ),
            ),
          ),
          _StepButton(
            icon: Icons.add,
            enabled: max == null || value < max!,
            onTap: () => _step(1),
          ),
        ],
      ),
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({required this.icon, required this.enabled, required this.onTap});

  final IconData icon;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(7),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(10),
          child: Ink(
            width: 46,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.border),
            ),
            child: Icon(
              icon,
              size: 20,
              color: enabled ? AppColors.primaryDeep : AppColors.textFaint,
            ),
          ),
        ),
      ),
    );
  }
}

/// Segmented status filter (Pending / Approved / Rejected / All).
class FilterTabs extends StatelessWidget {
  const FilterTabs({
    super.key,
    required this.options,
    required this.selected,
    required this.onChanged,
  });

  final List<String> options;
  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          for (final option in options)
            Expanded(
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => onChanged(option),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 160),
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  decoration: BoxDecoration(
                    color: selected == option ? AppColors.primary : Colors.transparent,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    option,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: selected == option ? Colors.white : AppColors.textSecondary,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Header row: icon + title (+ optional trailing widget).
class PanelHeader extends StatelessWidget {
  const PanelHeader({
    super.key,
    required this.icon,
    required this.title,
    required this.iconColor,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final Color iconColor;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 19, color: iconColor),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            title,
            style: const TextStyle(
              color: AppColors.textStrong,
              fontSize: 15,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        ?trailing,
      ],
    );
  }
}

/// Rounded dropdown matching the web `<select>` styling.
class AppDropdown<T> extends StatelessWidget {
  const AppDropdown({
    super.key,
    required this.value,
    required this.items,
    required this.onChanged,
    this.labelBuilder,
  });

  final T value;
  final List<T> items;
  final ValueChanged<T?> onChanged;
  final String Function(T value)? labelBuilder;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonHideUnderline(
      child: DropdownButton<T>(
        value: value,
        isDense: true,
        isExpanded: true,
        borderRadius: BorderRadius.circular(12),
        dropdownColor: AppColors.surface,
        icon: const Icon(Icons.keyboard_arrow_down, size: 18, color: AppColors.textMuted),
        style: const TextStyle(color: AppColors.textBody, fontSize: 12.5),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        onChanged: onChanged,
        items: [
          for (final item in items)
            DropdownMenuItem<T>(
              value: item,
              child: Text(
                labelBuilder?.call(item) ?? '$item',
                overflow: TextOverflow.ellipsis,
              ),
            ),
        ],
      ),
    );
  }
}

/// Wraps a dropdown in the bordered container used by the filter bar.
class DropdownShell extends StatelessWidget {
  const DropdownShell({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: child,
    );
  }
}

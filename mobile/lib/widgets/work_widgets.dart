import 'package:flutter/material.dart';

import '../core/palette.dart';
import '../core/theme.dart';
import 'common.dart';

/// The building blocks the breakdown, request and dashboard screens share:
/// a search box, a row of filter pills, a list row with a thumbnail and two
/// chips, and the detail screen's header and icon rows.

/// Rounded search field at the top of a list.
class SearchBox extends StatelessWidget {
  const SearchBox({super.key, required this.hint, required this.onChanged});

  final String hint;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => TextField(
    onChanged: onChanged,
    textInputAction: TextInputAction.search,
    style: const TextStyle(fontSize: 13.5, color: AppColors.textStrong),
    decoration: InputDecoration(
      hintText: hint,
      prefixIcon: const Icon(Icons.search, size: 19),
      contentPadding: const EdgeInsets.symmetric(vertical: 12),
    ),
  );
}

/// A row of pills - the selected one solid orange, the rest outlined.
class PillFilters extends StatelessWidget {
  const PillFilters({
    super.key,
    required this.options,
    required this.selected,
    required this.onChanged,
  });

  final List<String> options;
  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    child: Row(
      children: [
        for (final option in options)
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: _Pill(label: option, active: option == selected, onTap: () => onChanged(option)),
          ),
      ],
    ),
  );
}

class _Pill extends StatelessWidget {
  const _Pill({required this.label, required this.active, required this.onTap});

  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap,
    child: AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: active ? AppColors.primary : AppColors.surface,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: active ? AppColors.primary : AppColors.border),
        boxShadow: active ? AppShadows.card : null,
      ),
      child: Text(
        label,
        style: TextStyle(
          color: active ? Colors.white : AppColors.textSecondary,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
  );
}

/// Soft tinted chip: the colour of a priority or a state, as text on a wash.
class TintChip extends StatelessWidget {
  const TintChip(this.label, {super.key, required this.color, this.icon});

  final String label;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.11),
      borderRadius: BorderRadius.circular(999),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[Icon(icon, size: 11, color: color), const SizedBox(width: 4)],
        Text(
          label,
          style: TextStyle(color: color, fontSize: 10.5, fontWeight: FontWeight.w700),
        ),
      ],
    ),
  );
}

class PriorityChip extends StatelessWidget {
  const PriorityChip(this.priority, {super.key});

  final String priority;

  @override
  Widget build(BuildContext context) =>
      TintChip(priority, color: WorkColors.ofPriority(priority), icon: Icons.flag_outlined);
}

class StateChip extends StatelessWidget {
  const StateChip(this.state, {super.key});

  final String state;

  @override
  Widget build(BuildContext context) => TintChip(state, color: WorkColors.ofState(state));
}

/// The square at the left of a list row. The records carry no photo in the
/// list, so it is a tinted tile with an icon for the kind of work.
class WorkThumb extends StatelessWidget {
  const WorkThumb({super.key, required this.icon, required this.color, this.size = 54});

  final IconData icon;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    height: size,
    width: size,
    decoration: BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [color.withValues(alpha: 0.18), color.withValues(alpha: 0.06)],
      ),
      borderRadius: BorderRadius.circular(size * 0.24),
      border: Border.all(color: color.withValues(alpha: 0.18)),
    ),
    child: Icon(icon, size: size * 0.46, color: color),
  );
}

/// One breakdown, request or purchase in a list: thumbnail, title, code and
/// date, then priority on the left and state on the right.
class WorkListTile extends StatelessWidget {
  const WorkListTile({
    super.key,
    required this.icon,
    required this.title,
    required this.code,
    required this.state,
    this.date = '',
    this.priority = '',
    this.subtitle = '',
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String code;
  final String date;
  final String priority;
  final String state;

  /// A third line under the code: who it is waiting on, or the plant.
  final String subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => AppCard(
    onTap: onTap,
    padding: const EdgeInsets.all(12),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        WorkThumb(
          icon: icon,
          color: priority.isEmpty ? AppColors.primary : WorkColors.ofPriority(priority),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textStrong,
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                        height: 1.25,
                      ),
                    ),
                  ),
                  if (onTap != null)
                    const Icon(Icons.chevron_right, size: 18, color: AppColors.textFaint),
                ],
              ),
              const SizedBox(height: 3),
              Text(
                date.isEmpty ? code : '$code  •  $date',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: kMonoStyle.copyWith(
                  color: AppColors.textMuted,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (subtitle.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11.5, color: AppColors.textSecondary),
                ),
              ],
              const SizedBox(height: 8),
              Row(
                children: [
                  if (priority.isNotEmpty) PriorityChip(priority),
                  const Spacer(),
                  if (state.isNotEmpty) StateChip(state),
                ],
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

/// The top of a detail screen: a large tinted panel with the kind of work's
/// icon, then the title, its code and the two chips.
class WorkDetailHeader extends StatelessWidget {
  const WorkDetailHeader({
    super.key,
    required this.icon,
    required this.title,
    required this.code,
    required this.state,
    this.priority = '',
    this.extra = const [],
  });

  final IconData icon;
  final String title;
  final String code;
  final String state;
  final String priority;

  /// More chips after priority and state - a repeat failure, say.
  final List<Widget> extra;

  @override
  Widget build(BuildContext context) {
    final tint = priority.isEmpty ? AppColors.primary : WorkColors.ofPriority(priority);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          height: 150,
          width: double.infinity,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [tint.withValues(alpha: 0.20), AppColors.surfaceMuted],
            ),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: AppColors.border),
          ),
          child: Center(
            child: Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: AppColors.surface,
                shape: BoxShape.circle,
                boxShadow: AppShadows.raised,
              ),
              child: Icon(icon, size: 40, color: tint),
            ),
          ),
        ),
        const SizedBox(height: 14),
        Text(
          title,
          style: const TextStyle(
            color: AppColors.textStrong,
            fontSize: 19,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.3,
          ),
        ),
        const SizedBox(height: 3),
        MonoText(code, color: AppColors.textMuted, fontSize: 11.5),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            if (priority.isNotEmpty) PriorityChip(priority),
            if (state.isNotEmpty) StateChip(state),
            ...extra,
          ],
        ),
      ],
    );
  }
}

/// Icon tile, small grey label, value underneath - the detail card's rows.
class InfoRow extends StatelessWidget {
  const InfoRow({super.key, required this.icon, required this.label, required this.value});

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 7),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(7),
          decoration: BoxDecoration(
            color: AppColors.surfaceMuted,
            borderRadius: BorderRadius.circular(9),
          ),
          child: Icon(icon, size: 16, color: AppColors.textSecondary),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
              const SizedBox(height: 2),
              Text(
                value.isEmpty ? '—' : value,
                style: const TextStyle(
                  fontSize: 13,
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

/// A titled white card holding a paragraph - Description, Root cause, …
class TextSection extends StatelessWidget {
  const TextSection({super.key, required this.title, required this.text});

  final String title;
  final String text;

  @override
  Widget build(BuildContext context) => AppCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            color: AppColors.textStrong,
            fontSize: 13.5,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 6),
        Text(text, style: const TextStyle(fontSize: 13, color: AppColors.textBody, height: 1.45)),
      ],
    ),
  );
}

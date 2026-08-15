import 'package:flutter/material.dart';

import '../core/palette.dart';
import 'common.dart';

/// One column of an [AppTable]. Give it either a fixed [width] (for a short,
/// predictable value like a quantity) or a [flex] share of what is left, so the
/// grid always fits the screen and never scrolls sideways.
class AppTableColumn {
  const AppTableColumn(this.label, {this.width, this.flex = 0, this.center = false})
      : assert(width != null || flex > 0, 'a column needs a width or a flex');

  final String label;
  final double? width;
  final int flex;
  final bool center;
}

const double _chevronWidth = 20;
const double _gap = 8;

/// A phone-sized data grid: a header of column labels over rows that fit the
/// screen, where each row can unfold to the fields that did not fit across.
///
/// The web client shows these lists as wide tables (`pages/*/…List.jsx`); this
/// keeps the rows-and-columns reading without the sideways scroll a phone would
/// otherwise need.
class AppTable<T> extends StatefulWidget {
  const AppTable({
    super.key,
    required this.items,
    required this.columns,
    required this.idOf,
    required this.cellsOf,
    this.detailOf,
    this.onRowTap,
    this.onRowLongPress,
    this.selectedOf,
    this.padding = const EdgeInsets.fromLTRB(16, 4, 16, 16),
    this.bottomInset = 0,
  });

  final List<T> items;
  final List<AppTableColumn> columns;

  /// Stable identity per row, so unfolding survives a reload or a scroll.
  final String Function(T item) idOf;

  /// One widget per column, in [columns] order.
  final List<Widget> Function(BuildContext context, T item) cellsOf;

  /// The panel revealed under a row. When null the rows do not unfold and no
  /// chevron is drawn.
  final Widget Function(BuildContext context, T item)? detailOf;

  /// What tapping a row does — normally opening the record's own page. Given
  /// alongside [detailOf] it wins, which is how a screen turns taps into
  /// selection while a selection is under way.
  final void Function(BuildContext context, T item)? onRowTap;

  /// Holding a row, where a screen lets rows be picked out.
  final void Function(BuildContext context, T item)? onRowLongPress;

  /// Whether a row is currently picked, which tints it.
  final bool Function(T item)? selectedOf;

  final EdgeInsets padding;

  /// Extra room under the last row, e.g. so a floating action button does not
  /// sit on top of it.
  final double bottomInset;


  @override
  State<AppTable<T>> createState() => _AppTableState<T>();
}

class _AppTableState<T> extends State<AppTable<T>> {
  final _expanded = <String>{};

  void _toggle(String id) => setState(() {
        _expanded.contains(id) ? _expanded.remove(id) : _expanded.add(id);
      });

  @override
  Widget build(BuildContext context) {
    final expandable = widget.detailOf != null;

    final rows = ListView.builder(
      padding: EdgeInsets.only(bottom: widget.bottomInset),
      itemCount: widget.items.length,
      itemBuilder: _buildRow,
    );

    return Padding(
      padding: widget.padding,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
          boxShadow: AppShadows.card,
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: Column(
            children: [
              Container(
                height: 36,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: const BoxDecoration(
                  color: AppColors.surfaceMuted,
                  border: Border(bottom: BorderSide(color: AppColors.border)),
                ),
                child: _laidOut(
                  columns: widget.columns,
                  expandable: expandable,
                  cells: [
                    for (final column in widget.columns)
                      Text(
                        column.label.toUpperCase(),
                        textAlign: column.center ? TextAlign.center : TextAlign.start,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.5,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.6,
                        ),
                      ),
                  ],
                ),
              ),
              Expanded(child: rows),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRow(BuildContext context, int index) {
    final expandable = widget.detailOf != null;
    final item = widget.items[index];
    final id = widget.idOf(item);
    final expanded = _expanded.contains(id);
    final selected = widget.selectedOf?.call(item) ?? false;

    return Container(
      decoration: BoxDecoration(
        color: selected
            ? AppColors.accent.withValues(alpha: 0.06)
            : expanded
                ? AppColors.surfaceMuted
                : AppColors.surface,
        border: const Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: Column(
        children: [
          Material(
            color: Colors.transparent,
            child: InkWell(
              onLongPress: widget.onRowLongPress == null
                  ? null
                  : () => widget.onRowLongPress!(context, item),
              onTap: widget.onRowTap != null
                  ? () => widget.onRowTap!(context, item)
                  : expandable
                      ? () => _toggle(id)
                      : null,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                child: _laidOut(
                  columns: widget.columns,
                  expandable: expandable,
                  expanded: expanded,
                  cells: widget.cellsOf(context, item),
                ),
              ),
            ),
          ),
          // Built only while unfolded, so a folded row costs nothing and hides
          // its fields outright.
          if (expandable)
            AnimatedSize(
              duration: const Duration(milliseconds: 160),
              curve: Curves.easeOut,
              alignment: Alignment.topCenter,
              child: expanded
                  ? widget.detailOf!(context, item)
                  : const SizedBox(width: double.infinity),
            ),
        ],
      ),
    );
  }

  /// Spreads [cells] across [columns] — the one place the header and the rows
  /// agree on how wide each column is.
  Widget _laidOut({
    required List<AppTableColumn> columns,
    required List<Widget> cells,
    required bool expandable,
    bool? expanded,
  }) {
    assert(cells.length == columns.length, 'one cell per column');

    return Row(
      children: [
        for (var index = 0; index < columns.length; index++) ...[
          if (index > 0) const SizedBox(width: _gap),
          if (columns[index].width != null)
            SizedBox(
              width: columns[index].width,
              child: columns[index].center
                  ? Center(child: cells[index])
                  : cells[index],
            )
          else
            Expanded(flex: columns[index].flex, child: cells[index]),
        ],
        // The header only reserves the chevron's width; the arrow itself
        // belongs to the rows that can actually unfold.
        if (expandable)
          SizedBox(
            width: _chevronWidth,
            child: expanded == null
                ? null
                : AnimatedRotation(
                    turns: expanded ? 0.5 : 0,
                    duration: const Duration(milliseconds: 160),
                    child: const Icon(
                      Icons.keyboard_arrow_down,
                      size: 18,
                      color: AppColors.textMuted,
                    ),
                  ),
          ),
      ],
    );
  }
}

/// The product/name cell every table starts with: thumbnail, title and a muted
/// second line (usually the product code).
class TableTitleCell extends StatelessWidget {
  const TableTitleCell({
    super.key,
    required this.title,
    required this.subtitle,
    this.imageUrl = '',
  });

  final String title;
  final String subtitle;
  final String imageUrl;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        ProductThumb(imageUrl: imageUrl, size: 30, radius: 8),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textStrong,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle.isEmpty ? '—' : subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: AppColors.textMuted, fontSize: 10),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Plain text in a cell — two lines at most, so every row keeps its height.
class TableTextCell extends StatelessWidget {
  const TableTextCell(
    this.value, {
    super.key,
    this.color = AppColors.textStrong,
    this.weight = FontWeight.w600,
    this.size = 11.5,
  });

  final String value;
  final Color color;
  final FontWeight weight;
  final double size;

  @override
  Widget build(BuildContext context) => Text(
        value.isEmpty ? '—' : value,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: color, fontSize: size, fontWeight: weight, height: 1.25),
      );
}

/// A number over its unit, coloured by whatever the number means.
class TableNumberCell extends StatelessWidget {
  const TableNumberCell({
    super.key,
    required this.value,
    required this.color,
    this.unit = '',
    this.note = '',
  });

  final String value;
  final Color color;
  final String unit;

  /// Optional flag under the unit, e.g. `LOW`.
  final String note;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.w800),
        ),
        if (unit.isNotEmpty)
          Text(
            unit,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppColors.textMuted, fontSize: 9.5),
          ),
        if (note.isNotEmpty)
          Text(
            note.toUpperCase(),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: color,
              fontSize: 8.5,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.4,
            ),
          ),
      ],
    );
  }
}

/// A badge sized to its column — long wording is scaled down rather than
/// allowed to spill over the column boundary.
class TableBadgeCell extends StatelessWidget {
  const TableBadgeCell(this.label, {super.key, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => FittedBox(
        fit: BoxFit.scaleDown,
        child: AppBadge(label, color: color, uppercase: false, fontSize: 10),
      );
}

/// The panel under an unfolded row: label/value lines and, at the bottom, the
/// actions for that record.
class TableDetail extends StatelessWidget {
  const TableDetail({super.key, required this.lines, this.actions = const []});

  final List<Widget> lines;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 2, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Divider(height: 1, color: AppColors.border),
          const SizedBox(height: 10),
          ...lines,
          if (actions.isNotEmpty) ...[
            const SizedBox(height: 6),
            Wrap(spacing: 8, runSpacing: 8, children: actions),
          ],
        ],
      ),
    );
  }
}

/// One label/value pair of an unfolded row, labels in a fixed left column so
/// the values line up under each other.
class TableDetailLine extends StatelessWidget {
  const TableDetailLine({
    super.key,
    required this.label,
    required this.value,
    this.valueColor,
    this.italic = false,
    this.mono = false,
    this.maxLines = 3,
  });

  final String label;
  final String value;
  final Color? valueColor;
  final bool italic;
  final bool mono;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 92,
            child: Text(
              label,
              style: const TextStyle(color: AppColors.textMuted, fontSize: 11.5),
            ),
          ),
          Expanded(
            child: mono
                ? Align(
                    alignment: Alignment.centerLeft,
                    child: MonoText(
                      value.isEmpty ? '—' : value,
                      color: valueColor ?? AppColors.warning,
                      fontSize: 11.5,
                    ),
                  )
                : Text(
                    value.isEmpty ? '—' : value,
                    maxLines: maxLines,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: valueColor ?? AppColors.textPrimary,
                      fontSize: 12,
                      fontWeight: italic ? FontWeight.normal : FontWeight.w600,
                      fontStyle: italic ? FontStyle.italic : FontStyle.normal,
                      height: 1.3,
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

/// Secondary action in an unfolded row (open the details sheet, raise a
/// request); [filled] marks the one action that actually moves stock.
class TableActionButton extends StatelessWidget {
  const TableActionButton({
    super.key,
    required this.label,
    required this.icon,
    required this.color,
    required this.onPressed,
    this.filled = false,
  });

  final String label;
  final IconData icon;
  final Color color;
  final VoidCallback onPressed;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final text = const TextStyle(fontSize: 12, fontWeight: FontWeight.w700);
    final padding = const EdgeInsets.symmetric(horizontal: 12, vertical: 8);

    if (filled) {
      return FilledButton.icon(
        onPressed: onPressed,
        icon: Icon(icon, size: 15),
        label: Text(label),
        style: FilledButton.styleFrom(
          backgroundColor: color,
          padding: padding,
          textStyle: text,
        ),
      );
    }

    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: Icon(icon, size: 15),
      label: Text(label),
      style: OutlinedButton.styleFrom(
        foregroundColor: color,
        side: const BorderSide(color: AppColors.borderStrong),
        padding: padding,
        textStyle: text.copyWith(fontWeight: FontWeight.w600),
      ),
    );
  }
}

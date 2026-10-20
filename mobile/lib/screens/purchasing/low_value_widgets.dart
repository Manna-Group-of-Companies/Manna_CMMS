import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/formatters.dart';
import '../../core/palette.dart';
import '../../models/purchasing.dart';
import '../../widgets/common.dart';

/// Pieces the Purchase Request Sheet's list, detail and form share.

/// The sheet's own green for a finished row (#B7E1CD), as it fills a whole
/// row in the Google Sheet.
const sheetDoneGreen = Color(0xFFB7E1CD);

/// The same green softened onto white, for a card - the full shade behind a
/// card's text and chips reads as a warning rather than "done".
final sheetDoneFill = Color.alphaBlend(sheetDoneGreen.withValues(alpha: 0.45), AppColors.surface);

/// Teal for a partial approval: approved, but not all of it.
const _teal = Color(0xFF0F766E);

/// Purple for an item gone out to be repaired rather than bought.
const _purple = Color(0xFF7E22CE);

/// Sky blue for the steps before an order is placed - vendors, quotes, bids.
const _sky = Color(0xFF0369A1);

/// Orange between Emergency's red and Medium's amber.
const _orange = Color(0xFFC2410C);

/// Colours for the three status-like columns, the same as the web sheet's.
///
/// Not [StatusColors]: that one's language is the stock approvals', where
/// anything it does not know reads as pending - which would show a request
/// that has been delivered as still waiting.
abstract final class SheetColors {
  static Color approval(String status) => switch (status) {
        'Approved' => AppColors.success,
        'Rejected' => AppColors.danger,
        'Limited Quantity Approved' => _teal,
        'On Hold' => AppColors.textMuted,
        _ => AppColors.warning, // Pending, Pending MD Approval
      };

  /// Grey, then blue as it is bought, then green once it is in.
  static Color purchase(String status) => switch (status) {
        'Received' || 'Delivered' => AppColors.success,
        'Order Placed' || 'Order Dispatched' => AppColors.info,
        'Finding Vendors' || 'Gathering Quotations' || 'Bidding Stage' => _sky,
        'Sent for repair' => _purple,
        _ => AppColors.textMuted, // Not Ordered
      };

  static Color priority(String priority) => switch (priority) {
        'Emergency' => AppColors.danger,
        'High' => _orange,
        'Medium' => AppColors.warning,
        _ => AppColors.textMuted, // Low
      };

  /// The colour for a pick column's value, or null for one with no colours.
  static Color? of(String column, String value) => switch (column) {
        'approvalStatus' => approval(value),
        'purchaseStatus' => purchase(value),
        'priority' => priority(value),
        _ => null,
      };
}

/// A status, priority or other pick value as a chip in its colour. Kept in
/// the sheet's own case - "Pending MD Approval" uppercased is hard to read.
class SheetChip extends StatelessWidget {
  const SheetChip(this.value, {super.key, required this.color});

  SheetChip.approval(String status, {Key? key})
      : this(status, key: key, color: SheetColors.approval(status));
  SheetChip.purchase(String status, {Key? key})
      : this(status, key: key, color: SheetColors.purchase(status));
  SheetChip.priority(String priority, {Key? key})
      : this(priority, key: key, color: SheetColors.priority(priority));

  final String value;
  final Color color;

  /// [AppBadge]'s look, but the label trims to fit: "Limited Quantity
  /// Approved" in a narrow sheet cell would otherwise run out of it.
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: 0.16)),
        ),
        child: Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700),
        ),
      );
}

/// "YYYY-MM-DD", the form the API takes dates in.
String apiDay(DateTime day) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${day.year}-${two(day.month)}-${two(day.day)}';
}

class LvFieldLabel extends StatelessWidget {
  const LvFieldLabel(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(
          text,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.textMuted,
          ),
        ),
      );
}

/// A day picked from a calendar, with a way to clear it when it is optional.
class LvDateField extends StatelessWidget {
  const LvDateField({
    super.key,
    required this.value,
    required this.firstDate,
    required this.lastDate,
    required this.onChanged,
    this.placeholder = 'Choose a date',
    this.clearable = false,
  });

  final DateTime? value;
  final DateTime firstDate;
  final DateTime lastDate;
  final ValueChanged<DateTime?> onChanged;
  final String placeholder;
  final bool clearable;

  @override
  Widget build(BuildContext context) => Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              icon: const Icon(Icons.event_outlined, size: 18),
              label: Text(value == null ? placeholder : formatDate(value)),
              onPressed: () async {
                final now = DateTime.now();
                var initial = value ?? now;
                if (initial.isBefore(firstDate)) initial = firstDate;
                if (initial.isAfter(lastDate)) initial = lastDate;
                final picked = await showDatePicker(
                  context: context,
                  initialDate: initial,
                  firstDate: firstDate,
                  lastDate: lastDate,
                );
                if (picked != null) onChanged(picked);
              },
            ),
          ),
          if (clearable && value != null) ...[
            const SizedBox(width: 8),
            IconButton(
              tooltip: 'Clear',
              icon: const Icon(Icons.close, size: 18),
              onPressed: () => onChanged(null),
            ),
          ],
        ],
      );
}

/// An image read into memory, ready for `POST /low-value-purchases/:id/files`.
class PickedPhoto {
  const PickedPhoto({required this.name, required this.contentType, required this.bytes});

  final String name;
  final String contentType;
  final Uint8List bytes;
}

/// Thrown by [pickPhoto] with a sentence to show the person.
class PhotoProblem implements Exception {
  const PhotoProblem(this.message);

  final String message;

  @override
  String toString() => message;
}

const _maxPhotoBytes = 5 * 1024 * 1024;

/// A photo of the item from the camera or the gallery, the way a breakdown's
/// is taken: scaled down on the phone so it goes up over a mobile connection.
/// Null when the person backs out.
Future<PickedPhoto?> pickPhoto(ImageSource source) async {
  try {
    final picked = await ImagePicker().pickImage(
      source: source,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 75,
    );
    if (picked == null) return null;
    final bytes = await picked.readAsBytes();
    if (bytes.lengthInBytes > _maxPhotoBytes) {
      throw const PhotoProblem('That photo is too large (max 5 MB). Try another one.');
    }
    return PickedPhoto(name: picked.name, contentType: _mimeOf(picked), bytes: bytes);
  } on PlatformException catch (e) {
    throw PhotoProblem(
      e.message ?? 'Could not open the ${source == ImageSource.camera ? 'camera' : 'gallery'}',
    );
  } on PhotoProblem {
    rethrow;
  } catch (_) {
    throw const PhotoProblem('Could not attach that photo.');
  }
}

String _mimeOf(XFile file) {
  final mimeType = file.mimeType;
  if (mimeType != null && mimeType.startsWith('image/')) return mimeType;
  return switch (file.name.toLowerCase().split('.').last) {
    'png' => 'image/png',
    'webp' => 'image/webp',
    'gif' => 'image/gif',
    _ => 'image/jpeg',
  };
}

/// Camera or gallery, asked in a small sheet. Null when dismissed.
Future<ImageSource?> askPhotoSource(BuildContext context) => showModalBottomSheet<ImageSource>(
      context: context,
      useSafeArea: true,
      builder: (sheet) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take a photo'),
              onTap: () => Navigator.of(sheet).pop(ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose from gallery'),
              onTap: () => Navigator.of(sheet).pop(ImageSource.gallery),
            ),
          ],
        ),
      ),
    );

/// A row named in a line: its number and the first line of what is needed.
String requestHeadline(PurchaseRequest row) {
  final what = row.description.split('\n').first.trim();
  return what.isEmpty ? row.id : '${row.id} · $what';
}

/// Asked before a row is deleted, from the detail or a card held down in the
/// list - there is no undo. True to go ahead.
Future<bool> confirmDeleteRequest(BuildContext context, PurchaseRequest row) async {
  final sure = await showDialog<bool>(
    context: context,
    builder: (dialog) => AlertDialog(
      title: const Text('Delete this request?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            requestHeadline(row),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
          ),
          const SizedBox(height: 8),
          const Text('This cannot be undone.'),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(dialog).pop(false), child: const Text('Keep')),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
          onPressed: () => Navigator.of(dialog).pop(true),
          child: const Text('Delete'),
        ),
      ],
    ),
  );
  return sure == true;
}

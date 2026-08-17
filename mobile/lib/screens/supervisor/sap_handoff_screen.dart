import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/formatters.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/repository.dart';
import '../../models/models.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/common.dart';

/// The SAP naming hand-off (ST-13).
///
/// Module 1 does not integrate with SAP. Its job here is to make sure nothing
/// gets stocked under a name SAP has never heard of: every item created through
/// intake lands on this list until the Plant Manager has created it.
///
/// Read-only on the phone, deliberately. Marking an item created is an Admin
/// write and belongs in the web console — what the store needs standing in
/// front of the shelving is the *finalized name and its details*, in a form it
/// can send on. So each row copies out as a block of text.
class SapHandoffScreen extends StatefulWidget {
  const SapHandoffScreen({super.key});

  @override
  State<SapHandoffScreen> createState() => _SapHandoffScreenState();
}

class _SapHandoffScreenState extends State<SapHandoffScreen> {
  List<Product> _pending = const [];
  bool _loading = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final pending = await context.read<StockRepository>().sapPending();
      if (!mounted) return;
      setState(() {
        _pending = pending;
        _error = '';
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load the SAP hand-off list';
        _loading = false;
      });
    }
  }

  /// The whole queue as one block of text, for pasting into a message to the
  /// Plant Manager.
  Future<void> _copyAll() async {
    final lines = _pending.map(_asText).join('\n\n');
    await Clipboard.setData(ClipboardData(text: lines));
    Toast.success('${_pending.length} item(s) copied');
  }

  /// One item, laid out the way the Plant Manager needs to read it.
  String _asText(Product product) {
    final naming = product.naming;
    return [
      product.name,
      'Code: ${product.code}',
      if (naming?.itemCode.isNotEmpty == true) 'Item code: ${naming!.itemCode}',
      'Category: ${product.category}'
          '${product.subCategory.isEmpty ? '' : ' / ${product.subCategory}'}',
      if (product.brand.isNotEmpty) 'Brand: ${product.brand}',
      if (naming?.material.isNotEmpty == true) 'Material: ${naming!.material}',
      'UOM: ${product.unit}',
      if (product.unitCost > 0) 'Unit cost: ${formatCurrency(product.unitCost)}',
      'Plant: ${product.storeRoom}'
          '${product.rackNumber.isEmpty ? '' : ' · Rack ${product.rackNumber}'}',
      'Stock: ${product.quantity} ${product.unit}',
    ].join('\n');
  }

  @override
  Widget build(BuildContext context) {
    return AppShell(
      title: 'SAP Hand-off',
      actions: [
        if (_pending.isNotEmpty)
          IconButton(
            onPressed: _copyAll,
            icon: const Icon(Icons.copy_all_outlined, size: 22),
            tooltip: 'Copy the whole list',
          ),
      ],
      child: RefreshIndicator(
        onRefresh: _load,
        color: AppColors.primary,
        backgroundColor: AppColors.surfaceMuted,
        child: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const LoadingView(message: 'Loading the SAP hand-off list...');
    }

    if (_error.isNotEmpty) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 40, 16, 32),
        children: [
          EmptyState(
            icon: Icons.cloud_off_outlined,
            title: 'Could not load the list',
            message: _error,
          ),
        ],
      );
    }

    if (_pending.isEmpty) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 40, 16, 32),
        children: const [
          EmptyState(
            icon: Icons.verified_outlined,
            title: 'Nothing waiting for SAP',
            message: 'Every item named in the store has been created in SAP.',
          ),
        ],
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.accent.withValues(alpha: 0.07),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.accent.withValues(alpha: 0.2)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.swap_horiz, size: 16, color: AppColors.accent),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '${_pending.length} item${_pending.length == 1 ? '' : 's'} named in the '
                  'store and waiting for the Plant Manager to create in SAP. Copy one, or '
                  'the whole list from the top bar. Marking them created is done in the '
                  'admin console.',
                  style: const TextStyle(
                    color: AppColors.accentDeep,
                    fontSize: 11.5,
                    height: 1.45,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        for (final product in _pending)
          _PendingCard(
            product: product,
            onCopy: () async {
              await Clipboard.setData(ClipboardData(text: _asText(product)));
              Toast.success('Item details copied');
            },
          ),
      ],
    );
  }
}

class _PendingCard extends StatelessWidget {
  const _PendingCard({required this.product, required this.onCopy});

  final Product product;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    final naming = product.naming;

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: SelectableText(
                    product.name,
                    style: const TextStyle(
                      color: AppColors.textStrong,
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                      height: 1.35,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  onPressed: onCopy,
                  icon: const Icon(Icons.copy_outlined, size: 18),
                  color: AppColors.primaryDeep,
                  visualDensity: VisualDensity.compact,
                  tooltip: 'Copy these details',
                ),
              ],
            ),
            const SizedBox(height: 2),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                MonoText(product.code),
                // A name the convention rejected still has to reach SAP, but
                // the Plant Manager should know before typing it in.
                if (product.nameCompliant == false)
                  const AppBadge(
                    'Non-compliant name',
                    color: AppColors.warning,
                    icon: Icons.warning_amber_outlined,
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                SoftChip(product.category),
                SoftChip(
                  '${product.storeRoom}'
                  '${product.rackNumber.isEmpty ? '' : ' · ${product.rackNumber}'}',
                ),
                SoftChip('UOM ${product.unit}'),
                SoftChip('${product.quantity} ${product.unit} in stock'),
                if (naming?.material.isNotEmpty == true) SoftChip(naming!.material),
                if (naming?.itemCode.isNotEmpty == true) SoftChip(naming!.itemCode),
                if (product.unitCost > 0) SoftChip(formatCurrency(product.unitCost)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

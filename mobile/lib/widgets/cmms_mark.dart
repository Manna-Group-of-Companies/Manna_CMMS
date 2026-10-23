import 'package:flutter/material.dart';

/// The CMMS mark: a solid gear with a wrench cut through it (23 Oct 2026).
///
/// White, with the wrench transparent, so it sits on whatever is behind it -
/// the orange login tile and the orange splash alike. The same mark as the web
/// favicon (client/public/favicon.svg) and the Android launch screen
/// (res/drawable/ic_brand_mark.xml); change the three together.
class CmmsMark extends StatelessWidget {
  const CmmsMark({super.key, this.size = 40});

  final double size;

  static const asset = AssetImage('assets/brand/cmms_mark.png');

  @override
  Widget build(BuildContext context) => Image(
        image: asset,
        width: size,
        height: size,
        filterQuality: FilterQuality.medium,
        semanticLabel: 'Manna CMMS',
      );
}

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/api_client.dart';
import '../core/palette.dart';
import '../core/toast.dart';
import '../state/auth_provider.dart';
import '../state/server_provider.dart';
import '../widgets/common.dart';
import '../widgets/server_status_banner.dart';

/// Every account signs in with its name and a PIN of exactly this many digits.
const kPinLength = 4;

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _pin = TextEditingController();

  bool _loading = false;
  bool _obscure = true;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _pin.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();

    if (_name.text.trim().isEmpty || _pin.text.isEmpty) {
      setState(() => _error = 'Please fill in all fields');
      return;
    }
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final user = await context
          .read<AuthProvider>()
          .login(_name.text.trim(), _pin.text);
      Toast.success('Welcome back, ${user.name}!');
      // Routing is handled by the router's redirect once `user` is set.
    } on ApiException catch (error) {
      // A 403 carries something the user needs to read verbatim — an account
      // whose PIN an admin has not issued yet.
      final message = error.statusCode == 401
          ? 'Invalid name or PIN. Please try again.'
          : error.message;
      if (mounted) setState(() => _error = message);
      Toast.error(message);
      // The request never landed — let the banner take over and go looking
      // for the server instead of leaving the user to guess.
      if (error.isNetworkError && mounted) {
        unawaited(context.read<ServerProvider>().recheck());
      }
    } catch (error) {
      const message = 'Something went wrong. Please try again.';
      if (mounted) setState(() => _error = message);
      Toast.error(message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.canvas,
      body: Stack(
        children: [
          // A soft teal wash behind the top of the page, mirroring the hero
          // tile on the dashboard.
          Container(
            height: 260,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  AppColors.primary.withValues(alpha: 0.10),
                  AppColors.canvas.withValues(alpha: 0),
                ],
              ),
            ),
          ),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Logo + heading
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          gradient: AppGradients.primary,
                          borderRadius: BorderRadius.circular(18),
                          boxShadow: AppShadows.raised,
                        ),
                        child: const Icon(
                          Icons.widgets_outlined,
                          size: 38,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(height: 14),
                      const Text(
                        'StockMaster',
                        style: TextStyle(
                          color: AppColors.textStrong,
                          fontSize: 28,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.6,
                        ),
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        'Stock Management System',
                        style: TextStyle(color: AppColors.textMuted, fontSize: 13),
                      ),
                      const SizedBox(height: 28),

                      // Connection state — only visible when the API is
                      // unreachable or still being located.
                      const ServerStatusBanner(),

                      // Login card
                      AppCard(
                        padding: const EdgeInsets.all(24),
                        borderRadius: 20,
                        child: Form(
                          key: _formKey,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              const Center(
                                child: Text(
                                  'Sign In to Portal',
                                  style: TextStyle(
                                    color: AppColors.textStrong,
                                    fontSize: 17,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                              const SizedBox(height: 20),
                              if (_error != null) ...[
                                Container(
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: AppColors.danger.withValues(alpha: 0.08),
                                    borderRadius: BorderRadius.circular(10),
                                    border: Border.all(
                                        color: AppColors.danger.withValues(alpha: 0.22)),
                                  ),
                                  child: Text(
                                    _error!,
                                    style: const TextStyle(
                                      color: AppColors.danger,
                                      fontSize: 12,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 16),
                              ],
                              const _FieldLabel('Name'),
                              TextFormField(
                                controller: _name,
                                textInputAction: TextInputAction.next,
                                textCapitalization: TextCapitalization.words,
                                autocorrect: false,
                                style: const TextStyle(
                                    fontSize: 14, color: AppColors.textStrong),
                                decoration: const InputDecoration(
                                  hintText: 'Your account name',
                                  prefixIcon: Icon(Icons.person_outline, size: 18),
                                ),
                                validator: (value) => (value ?? '').trim().isEmpty
                                    ? 'Name is required'
                                    : null,
                              ),
                              const SizedBox(height: 18),
                              const _FieldLabel('$kPinLength-Digit PIN'),
                              TextFormField(
                                controller: _pin,
                                obscureText: _obscure,
                                keyboardType: TextInputType.number,
                                inputFormatters: [
                                  FilteringTextInputFormatter.digitsOnly,
                                  LengthLimitingTextInputFormatter(kPinLength),
                                ],
                                textInputAction: TextInputAction.done,
                                onFieldSubmitted: (_) => _loading ? null : _submit(),
                                style: const TextStyle(
                                  fontSize: 18,
                                  letterSpacing: 8,
                                  color: AppColors.textStrong,
                                ),
                                decoration: InputDecoration(
                                  hintText: '••••',
                                  hintStyle: const TextStyle(letterSpacing: 8),
                                  prefixIcon: const Icon(Icons.pin_outlined, size: 18),
                                  suffixIcon: IconButton(
                                    icon: Icon(
                                      _obscure
                                          ? Icons.visibility_outlined
                                          : Icons.visibility_off_outlined,
                                      size: 18,
                                    ),
                                    color: AppColors.textMuted,
                                    onPressed: () => setState(() => _obscure = !_obscure),
                                  ),
                                ),
                                validator: (value) {
                                  final text = value ?? '';
                                  if (text.isEmpty) return 'PIN is required';
                                  if (text.length != kPinLength) {
                                    return 'Your PIN is $kPinLength digits';
                                  }
                                  return null;
                                },
                              ),
                              const SizedBox(height: 24),
                              SizedBox(
                                height: 48,
                                child: FilledButton(
                                  onPressed: _loading ? null : _submit,
                                  style: FilledButton.styleFrom(
                                    padding: EdgeInsets.zero,
                                  ),
                                  child: _loading
                                      ? const SizedBox(
                                          height: 20,
                                          width: 20,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2.4,
                                            color: Colors.white,
                                          ),
                                        )
                                      : const Text(
                                          'Sign In',
                                          style: TextStyle(
                                            fontSize: 14,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),

                      const SizedBox(height: 28),
                      const ServerAddressChip(),
                    ],
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

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(
          text.toUpperCase(),
          style: const TextStyle(
            color: AppColors.textSecondary,
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
            letterSpacing: 1,
          ),
        ),
      );
}


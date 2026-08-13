import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api_client.dart';
import '../core/palette.dart';
import '../core/toast.dart';
import '../state/auth_provider.dart';
import '../state/server_provider.dart';
import '../widgets/common.dart';
import '../widgets/server_status_banner.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();

  bool _loading = false;
  bool _obscure = true;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();

    if (_email.text.trim().isEmpty || _password.text.isEmpty) {
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
          .login(_email.text.trim(), _password.text);
      Toast.success('Welcome back, ${user.name}!');
      // Routing is handled by the router's redirect once `user` is set.
    } on ApiException catch (error) {
      final message = error.statusCode == 401
          ? 'Invalid credentials. Please try again.'
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

  void _prefill(String email, String password) {
    setState(() {
      _email.text = email;
      _password.text = password;
      _error = null;
    });
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
                              const _FieldLabel('Email Address'),
                              TextFormField(
                                controller: _email,
                                keyboardType: TextInputType.emailAddress,
                                textInputAction: TextInputAction.next,
                                autocorrect: false,
                                style: const TextStyle(
                                    fontSize: 14, color: AppColors.textStrong),
                                decoration: const InputDecoration(
                                  hintText: 'name@company.com',
                                  prefixIcon: Icon(Icons.mail_outline, size: 18),
                                ),
                                validator: (value) {
                                  final text = value?.trim() ?? '';
                                  if (text.isEmpty) return 'Email is required';
                                  if (!text.contains('@')) return 'Enter a valid email address';
                                  return null;
                                },
                              ),
                              const SizedBox(height: 18),
                              const _FieldLabel('Password'),
                              TextFormField(
                                controller: _password,
                                obscureText: _obscure,
                                textInputAction: TextInputAction.done,
                                onFieldSubmitted: (_) => _loading ? null : _submit(),
                                style: const TextStyle(
                                    fontSize: 14, color: AppColors.textStrong),
                                decoration: InputDecoration(
                                  hintText: '••••••••',
                                  prefixIcon: const Icon(Icons.lock_outline, size: 18),
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
                                validator: (value) =>
                                    (value ?? '').isEmpty ? 'Password is required' : null,
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

                      // Demo credentials
                      const SizedBox(height: 28),
                      const Text(
                        'Quick Login (Demo Accounts):',
                        style: TextStyle(color: AppColors.textMuted, fontSize: 12),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: _PrefillButton(
                              label: 'Store Supervisor',
                              color: AppColors.primaryDeep,
                              onTap: _loading
                                  ? null
                                  : () => _prefill('supervisor@stock.com', 'Supervisor@123'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: _PrefillButton(
                              label: 'Branch',
                              color: AppColors.accent,
                              onTap: _loading
                                  ? null
                                  : () => _prefill('branch@stock.com', 'Branch@123'),
                            ),
                          ),
                        ],
                      ),

                      const SizedBox(height: 20),
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

class _PrefillButton extends StatelessWidget {
  const _PrefillButton({required this.label, required this.color, this.onTap});

  final String label;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        foregroundColor: color,
        backgroundColor: AppColors.surface,
        side: const BorderSide(color: AppColors.borderStrong),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      ),
      child: Text(label, style: const TextStyle(fontSize: 12)),
    );
  }
}

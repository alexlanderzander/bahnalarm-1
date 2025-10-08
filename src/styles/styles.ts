import { StyleSheet } from 'react-native';

export const colors = {
  background: '#000000',
  panel: '#1C1C1E',      // A very dark grey, like iOS dark mode panels
  border: '#38383A',
  text: '#FFFFFF',
  textMuted: '#8E8E93', // A muted grey for secondary text
  accent: '#FFFFFF',     // White is now the primary accent
  accentText: '#000000', // Black text for on-accent components like buttons
  success: '#34C759',    // Apple's system green
  error: '#FF3B30',      // Apple's system red
};

export const theme = StyleSheet.create({
  // --- Layout --- //
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: colors.background,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  // --- Panels --- //
  panel: {
    backgroundColor: colors.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },

  // --- Typography --- //
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 15,
  },
  body: {
    fontSize: 16,
    color: colors.text,
  },
  label: {
    fontSize: 16,
    color: colors.textMuted,
    marginBottom: 8,
  },

  // --- Components --- //
  button: {
    backgroundColor: colors.accent, // White button
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: colors.accentText, // Black text
    fontSize: 18,
    fontWeight: 'bold',
  },
  input: {
    backgroundColor: colors.panel,
    color: colors.text,
    padding: 15,
    borderRadius: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginVertical: 5,
  },
});
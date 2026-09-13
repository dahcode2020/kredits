/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>'],
  testMatch: ['<rootDir>/__tests__/**/*.(spec|test).ts?(x)', '<rootDir>/tests/**/*.(spec|test).ts?(x)', '<rootDir>/src/**/*.(spec|test).ts?(x)', '<rootDir>/lib/**/*.(spec|test).ts?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '\\.(css|less|scss|sass)$': '<rootDir>/tests/__mocks__/styleMock.js',
  },
  // Le fuseau du CI ne doit pas décider du résultat: voir tests/global-setup.js
  globalSetup: '<rootDir>/tests/global-setup.js',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  transform: {
    // Config ts-jest modern (le bloc `globals: { 'ts-jest': … }` est déprécié)
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', esModuleInterop: true, allowSyntheticDefaultImports: true } }],
  },
  collectCoverageFrom: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}', '!**/*.d.ts'],
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
};

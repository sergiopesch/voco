Name: libsentencepiece0
Version: 0.2.1
Release: 2
Summary: SentencePiece tokenizer shared library for VOCO
License: Apache-2.0
URL: https://github.com/google/sentencepiece
Source0: https://codeload.github.com/google/sentencepiece/tar.gz/31646a467d2051eb904e0b45de3a73e91fe1c1e3#/sentencepiece-31646a467d2051eb904e0b45de3a73e91fe1c1e3.tar.gz
BuildRequires: cmake
BuildRequires: gcc-c++
BuildRequires: make
%global debug_package %{nil}

%description
Pinned upstream SentencePiece processor library. This companion package supplies
VOCO's existing tokenizer dependency on distributions without a native provider.
It does not change the speech model or recognition settings.

%prep
echo 'b4eb17e6bea5c9380ddd79d04d01d6aa5e280be8f3e3cef1f745a80e6d9451ce  %{SOURCE0}' | sha256sum -c -
%setup -q -n sentencepiece-31646a467d2051eb904e0b45de3a73e91fe1c1e3

%build
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr \
  -DCMAKE_INSTALL_LIBDIR=%{_lib} -DSPM_ENABLE_SHARED=ON \
  -DSPM_ENABLE_TCMALLOC=OFF -DSPM_BUILD_TEST=ON
cmake --build build --parallel 2

%check
ctest --test-dir build --output-on-failure --no-tests=error

%install
install -d %{buildroot}%{_libdir}
cp -a build/src/libsentencepiece.so.0* %{buildroot}%{_libdir}/

%files
%license LICENSE
%{_libdir}/libsentencepiece.so.0*

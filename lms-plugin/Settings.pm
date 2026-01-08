package Plugins::UnifiedHiFi::Settings;

# Settings page for Unified Hi-Fi Control plugin

use strict;
use warnings;

use base qw(Slim::Web::Settings);

use Slim::Utils::Prefs;
use Slim::Utils::Log;
use Slim::Utils::Strings qw(string);

use Plugins::UnifiedHiFi::Helper;

my $log = logger('plugin.unifiedhifi');
my $prefs = preferences('plugin.unifiedhifi');

sub name {
    return 'PLUGIN_UNIFIED_HIFI';
}

sub page {
    return 'plugins/UnifiedHiFi/settings/basic.html';
}

sub prefs {
    return ($prefs, qw(autorun port bin loglevel));
}

sub handler {
    my ($class, $client, $params, $callback, @args) = @_;

    # Handle start/stop actions
    if ($params->{'start'}) {
        Plugins::UnifiedHiFi::Helper->start();
    }
    elsif ($params->{'stop'}) {
        Plugins::UnifiedHiFi::Helper->stop();
    }

    # Save preferences if form submitted
    if ($params->{'saveSettings'}) {
        my $needsRestart = 0;

        # Check if port changed
        my $newPort = $params->{'pref_port'} || 8088;
        if ($newPort != ($prefs->get('port') || 8088)) {
            $needsRestart = 1;
        }

        # Check if binary changed
        my $newBin = $params->{'pref_bin'};
        if ($newBin && $newBin ne ($prefs->get('bin') || '')) {
            $needsRestart = 1;
        }

        # Save preferences
        $prefs->set('autorun',  $params->{'pref_autorun'} ? 1 : 0);
        $prefs->set('port',     $newPort);
        $prefs->set('bin',      $newBin) if $newBin;
        $prefs->set('loglevel', $params->{'pref_loglevel'} || 'info');

        # Restart if running and settings changed
        if ($needsRestart && Plugins::UnifiedHiFi::Helper->running()) {
            $log->info("Settings changed, restarting helper");
            Plugins::UnifiedHiFi::Helper->stop();
            Plugins::UnifiedHiFi::Helper->start() if $prefs->get('autorun');
        }
    }

    return $class->SUPER::handler($client, $params, $callback, @args);
}

sub beforeRender {
    my ($class, $params, $client) = @_;

    # Add template variables
    $params->{'running'}    = Plugins::UnifiedHiFi::Helper->running();
    $params->{'webUrl'}     = Plugins::UnifiedHiFi::Helper->webUrl();
    $params->{'binaries'}   = [Plugins::UnifiedHiFi::Helper->binaries()];
    $params->{'loglevels'}  = ['error', 'warn', 'info', 'debug'];

    return $class->SUPER::beforeRender($params, $client);
}

1;

__END__

=head1 NAME

Plugins::UnifiedHiFi::Settings - Web UI settings page

=head1 DESCRIPTION

Provides the settings interface for configuring the Unified Hi-Fi Control plugin.

=cut
